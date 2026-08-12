import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callLlm } from '$lib/server/llm';
import {
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
				max_tokens: 4000
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
