import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callLlm } from '$lib/server/llm';
import {
	balanceCheck,
	chunkStatementText,
	detectImageMimeType,
	extractRowsFromImage,
	extractRowsFromText,
	extractTextFromPdf,
	isPdf
} from './import-extract';

vi.mock('$lib/server/llm', () => ({ callLlm: vi.fn() }));

const mockedCallLlm = vi.mocked(callLlm);

beforeEach(() => {
	mockedCallLlm.mockReset();
});

describe('detectImageMimeType', () => {
	it('detects PNG, JPEG and WebP from their file signatures', () => {
		expect(
			detectImageMimeType(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
			)
		).toBe('image/png');
		expect(detectImageMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
			'image/jpeg'
		);
		expect(detectImageMimeType(Buffer.from('RIFF....WEBP', 'ascii'))).toBe(
			'image/webp'
		);
	});

	it('rejects files that do not contain a supported image signature', () => {
		expect(detectImageMimeType(Buffer.from('not an image'))).toBeNull();
	});
});

// Minimal single-page PDF with one text object, enough for pdf.js to produce a
// text layer without checking a binary fixture into the repo.
function buildPdf(text: string): Buffer {
	const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
	];
	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	objects.forEach((object, index) => {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets)
		pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
	return Buffer.from(pdf, 'latin1');
}

describe('isPdf', () => {
	it('detects the PDF signature and rejects other content', () => {
		expect(isPdf(buildPdf('extrato'))).toBe(true);
		expect(isPdf(Buffer.from('data,descricao,valor'))).toBe(false);
		expect(
			isPdf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		).toBe(false);
	});
});

describe('extractTextFromPdf', () => {
	it('returns the text layer and page count of a readable PDF', async () => {
		const result = await extractTextFromPdf(buildPdf('PIX TRANSF TESTE'));
		expect(result?.pages).toBe(1);
		expect(result?.text).toContain('PIX TRANSF TESTE');
	});

	it('returns null when the file cannot be parsed as a PDF', async () => {
		const errorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		await expect(
			extractTextFromPdf(Buffer.from('%PDF-1.4 truncado'))
		).resolves.toBeNull();
		errorSpy.mockRestore();
	});
});

describe('AI extraction', () => {
	it('validates and normalizes transactions returned from pasted text', async () => {
		mockedCallLlm.mockResolvedValue({
			choices: [
				{
					message: {
						content:
							'```json\n{"transactions":[{"date":"2026-05-01","description":"Loja Exemplo 2/3","amount":-25}],"confidence":0.9,"notes":"Uma linha"}\n```'
					}
				}
			]
		} as never);

		const result = await extractRowsFromText(
			'Compra na Loja Exemplo',
			'credit_card',
			'2026-05'
		);

		expect(result).toEqual({
			rows: [
				{
					date: '2026-05-01',
					description: 'Loja Exemplo 2/3',
					amount: -25,
					currency: 'BRL',
					clean_description: 'LOJA EXEMPLO 2/3',
					installment_number: 2,
					installment_total: 3,
					installment_group_key: 'LOJA EXEMPLO|3|25.00'
				}
			],
			confidence: 0.9,
			notes: 'Uma linha'
		});
		expect(mockedCallLlm).toHaveBeenCalledWith(
			expect.objectContaining({
				json_mode: true,
				temperature: 0,
				max_tokens: 8000
			})
		);
	});

	it('sends images as data URLs and accepts default extraction values', async () => {
		mockedCallLlm.mockResolvedValue({
			choices: [{ message: { content: '{}' } }]
		} as never);

		await expect(
			extractRowsFromImage(
				Buffer.from([1, 2, 3]),
				'image/png',
				'bank_account',
				'2026-05'
			)
		).resolves.toEqual({ rows: [], confidence: 0, notes: undefined });

		const request = mockedCallLlm.mock.calls[0][0];
		expect(request.messages[1]).toEqual({
			role: 'user',
			content: [
				{
					type: 'text',
					text: 'Extraia as transações desta imagem de fatura/extrato.'
				},
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } }
			]
		});
	});

	it('forces the amount sign to match the declared direction', async () => {
		mockedCallLlm.mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({
							transactions: [
								{
									date: '2026-06-30',
									description: 'Grupo Anjo Azul',
									amount: 60,
									direction: 'out',
									direction_cue: 'icone'
								},
								{
									date: '2026-06-22',
									description: 'Proventos recebidos BDIF11',
									amount: -44.2,
									direction: 'in',
									direction_cue: 'semantica'
								},
								{
									date: '2026-06-20',
									description: 'Sem direção',
									amount: -5
								}
							],
							confidence: 0.7
						})
					}
				}
			]
		} as never);

		const result = await extractRowsFromText(
			'extrato',
			'bank_account',
			'2026-06'
		);

		expect(result.rows.map((r) => r.amount)).toEqual([-60, 44.2, -5]);
		expect(result.confidence).toBe(0.7);
	});

	it('instructs the model to derive direction from Brazilian statement cues', async () => {
		mockedCallLlm.mockResolvedValue({
			choices: [{ message: { content: '{}' } }]
		} as never);

		await extractRowsFromText('extrato', 'bank_account', '2026-06');

		const system = mockedCallLlm.mock.calls[0][0].messages[0].content;
		expect(system).toContain('direction');
		expect(system).toContain('Agendamento cancelado');
		expect(system).toContain('"+" prefix');
	});

	it('rejects invalid model payloads and handles provider failures safely', async () => {
		mockedCallLlm.mockResolvedValue({
			choices: [
				{
					message: {
						content:
							'{"transactions":[{"date":"invalid","description":"X","amount":1}]}'
					}
				}
			]
		} as never);
		await expect(
			extractRowsFromText('conteúdo', 'bank_account', '2026-05')
		).resolves.toEqual({
			rows: [],
			confidence: 0,
			notes: 'A IA não retornou transações em formato válido.'
		});

		const errorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		mockedCallLlm.mockRejectedValueOnce(new Error('indisponível'));
		await expect(
			extractRowsFromText('conteúdo', 'bank_account', '2026-05')
		).resolves.toEqual({
			rows: [],
			confidence: 0,
			notes: 'Falha ao interpretar o conteúdo com IA.'
		});
		errorSpy.mockRestore();
	});
});

const ITAU_ROWS = [
	['2026-09-29', 'PIX TRANSF CLEUSA 29/09', -1100],
	['2026-09-29', 'REND PAGO APLIC AUT MAIS', 0.2],
	['2026-09-22', 'DA COMGAS 24082732', -52.59],
	['2026-09-22', 'REND PAGO APLIC AUT MAIS', 0.01],
	['2026-09-17', 'PIX QRS ENJOEI17/09', -96.77],
	['2026-09-17', 'REND PAGO APLIC AUT MAIS', 0.02],
	['2026-09-16', 'SISPAG CARE PLUS', 450],
	['2026-09-16', 'DEV PIX ENJOEI16/09', 141.74],
	['2026-09-15', 'PIX QRS ENJOEI15/09', -141.74],
	['2026-09-15', 'SISPAG CARE PLUS', 1222.44],
	['2026-09-10', 'REND PAGO APLIC AUT MAIS', 0.01],
	['2026-09-10', 'DA ELETROPAULO 2475', -65.05],
	['2026-09-08', 'REND PAGO APLIC AUT MAIS', 0.03],
	['2026-09-08', 'DA COMGAS 57643091', -186.26],
	['2026-09-03', 'PIX TRANSF Tales C03/09', 1000],
	['2026-09-01', 'REND PAGO APLIC AUT MAIS', 0.01],
	['2026-09-01', 'DA VIVO-SP 13439017', -100]
] as const;

function llmReply(content: unknown, finishReason = 'stop') {
	return {
		choices: [
			{
				message: {
					content:
						typeof content === 'string' ? content : JSON.stringify(content)
				},
				finish_reason: finishReason
			}
		]
	} as never;
}

function itauReply(rows: readonly (readonly [string, string, number])[]) {
	return llmReply({
		transactions: rows.map(([date, description, amount]) => ({
			date,
			description,
			amount
		})),
		opening_balance: 1148.29,
		closing_balance: 2220.34,
		confidence: 0.95
	});
}

describe('chunkStatementText', () => {
	it('returns nothing for empty input and one chunk for short input', () => {
		expect(chunkStatementText('  \n ')).toEqual([]);
		expect(chunkStatementText('a\nb')).toEqual(['a\nb']);
	});

	it('never cuts a line and keeps the original order', () => {
		const lines = Array.from({ length: 40 }, (_, i) =>
			`linha ${i}`.padEnd(30, 'x')
		);
		const chunks = chunkStatementText(lines.join('\n'), 200);

		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.length <= 200)).toBe(true);
		expect(chunks.flatMap((chunk) => chunk.split('\n'))).toEqual(lines);
	});

	it('accepts page texts and splits a page larger than the limit', () => {
		const page = Array.from({ length: 30 }, (_, i) =>
			`p1-${i}`.padEnd(20, '.')
		).join('\n');
		const chunks = chunkStatementText([page, 'p2-0'], 100);

		expect(chunks.length).toBeGreaterThan(2);
		expect(chunks.join('\n')).toBe(`${page}\np2-0`);
	});

	it('only splits mid-line when a single line exceeds the limit', () => {
		expect(chunkStatementText('x'.repeat(25), 10)).toEqual([
			'x'.repeat(10),
			'x'.repeat(10),
			'x'.repeat(5)
		]);
	});
});

describe('balanceCheck', () => {
	it('sums rows in cents against the printed balances', () => {
		const rows = [{ amount: 0.1 }, { amount: 0.2 }, { amount: -0.05 }];

		expect(balanceCheck(rows, 10, 10.25)).toEqual({ difference: 0 });
		expect(balanceCheck(rows, 10, 10.3)).toEqual({ difference: -0.05 });
	});

	it('does not check when the statement printed no balances', () => {
		expect(balanceCheck([{ amount: 1 }], null, 5)).toBeNull();
		expect(balanceCheck([{ amount: 1 }], 4, undefined)).toBeNull();
	});
});

describe('statement balance check', () => {
	it('accepts the September Itaú statement when every line was read', async () => {
		mockedCallLlm.mockResolvedValue(itauReply(ITAU_ROWS));

		const result = await extractRowsFromText(
			'extrato itaú',
			'bank_account',
			'2026-09'
		);

		expect(result.rows).toHaveLength(17);
		expect(result.confidence).toBe(0.95);
		expect(result.notes).toBeUndefined();
	});

	it('flags a missing line and caps the confidence', async () => {
		mockedCallLlm.mockResolvedValue(
			itauReply(
				ITAU_ROWS.filter(([, description]) => !description.includes('VIVO'))
			)
		);

		const result = await extractRowsFromText(
			'extrato itaú',
			'bank_account',
			'2026-09'
		);

		expect(result.rows).toHaveLength(16);
		expect(result.confidence).toBe(0.6);
		expect(result.notes).toContain('Saldo não fecha: diferença de R$ 100,00');
	});
});

describe('chunked extraction', () => {
	const longStatement = Array.from(
		{ length: 3 },
		(_, part) => `${'x'.repeat(7000)}${part}`
	).join('\n');

	it('reads each chunk with its own call, keeping the rows of every part', async () => {
		mockedCallLlm
			.mockResolvedValueOnce(
				llmReply({
					transactions: [{ date: '2026-09-01', description: 'A', amount: -1 }],
					confidence: 0.9
				})
			)
			.mockResolvedValueOnce(
				llmReply({
					transactions: [{ date: '2026-09-02', description: 'B', amount: -2 }],
					confidence: 0.8
				})
			)
			.mockResolvedValueOnce(
				llmReply({
					transactions: [{ date: '2026-09-03', description: 'C', amount: 3 }],
					confidence: 0.95
				})
			);

		const result = await extractRowsFromText(
			longStatement,
			'bank_account',
			'2026-09'
		);

		expect(mockedCallLlm).toHaveBeenCalledTimes(3);
		expect(result.rows.map((r) => r.description)).toEqual(['A', 'B', 'C']);
		expect(result.confidence).toBe(0.8);
		const second = mockedCallLlm.mock.calls[1][0];
		expect(second.messages[0].content).toContain('part 2 of 3');
		expect(second.max_tokens).toBe(8000);
	});

	it('reports a failed part by number without discarding the others', async () => {
		const errorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		mockedCallLlm
			.mockResolvedValueOnce(
				llmReply({
					transactions: [{ date: '2026-09-01', description: 'A', amount: -1 }],
					confidence: 0.9
				})
			)
			.mockRejectedValueOnce(new Error('indisponível'))
			.mockResolvedValueOnce(
				llmReply({
					transactions: [{ date: '2026-09-03', description: 'C', amount: 3 }],
					confidence: 0.95
				})
			);

		const result = await extractRowsFromText(
			longStatement,
			'bank_account',
			'2026-09'
		);

		expect(result.rows.map((r) => r.description)).toEqual(['A', 'C']);
		expect(result.notes).toBe('Parte 2 de 3 não pôde ser lida.');
		expect(result.confidence).toBe(0.6);
		errorSpy.mockRestore();
	});

	it('picks opening and closing balances by date even when listed newest first', async () => {
		mockedCallLlm
			.mockResolvedValueOnce(
				llmReply({
					transactions: [
						{ date: '2026-09-20', description: 'novo', amount: 50 }
					],
					opening_balance: 110,
					closing_balance: 160,
					confidence: 0.9
				})
			)
			.mockResolvedValueOnce(
				llmReply({
					transactions: [
						{ date: '2026-09-02', description: 'velho', amount: 10 }
					],
					opening_balance: 100,
					closing_balance: 110,
					confidence: 0.9
				})
			);

		const result = await extractRowsFromText(
			`${'x'.repeat(7000)}\n${'y'.repeat(7000)}`,
			'bank_account',
			'2026-09'
		);

		expect(result.notes).toBeUndefined();
		expect(result.rows).toHaveLength(2);
	});
});

describe('truncated replies', () => {
	it('keeps valid rows from a cut reply and says so', async () => {
		mockedCallLlm.mockResolvedValue(
			llmReply(
				{
					transactions: [{ date: '2026-09-01', description: 'A', amount: -1 }],
					confidence: 0.9
				},
				'length'
			)
		);

		const result = await extractRowsFromText('x', 'bank_account', '2026-09');

		expect(result.rows).toHaveLength(1);
		expect(result.confidence).toBe(0.6);
		expect(result.notes).toContain('foi cortada');
	});

	it('explains an unreadable cut reply instead of a generic failure', async () => {
		mockedCallLlm.mockResolvedValue(
			llmReply('{"transactions":[{"date":"2026-09-01","descr', 'length')
		);

		const result = await extractRowsFromText('x', 'bank_account', '2026-09');

		expect(result.rows).toEqual([]);
		expect(result.notes).toContain('períodos menores');
	});
});
