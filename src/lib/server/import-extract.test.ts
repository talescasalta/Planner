import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callLlm } from '$lib/server/llm';
import {
	detectImageMimeType,
	extractRowsFromImage,
	extractRowsFromText
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
