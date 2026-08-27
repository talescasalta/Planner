import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
	fetchBrapiQuotes,
	ingestTesouroCsvLine,
	tesouroKeyFromProductName,
	tesouroMatchKey
} from './investment-quotes';

describe('tesouro matching', () => {
	it('builds the same key from product names and CSV rows', () => {
		expect(tesouroKeyFromProductName('TESOURO IPCA+ 2032')).toBe(
			tesouroMatchKey('Tesouro IPCA+', '2032')
		);
		expect(
			tesouroKeyFromProductName('TESOURO IPCA+ COM JUROS SEMESTRAIS 2030')
		).toBe(tesouroMatchKey('Tesouro IPCA+ com Juros Semestrais', '2030'));
		expect(tesouroKeyFromProductName('BOVA11')).toBeNull();
	});

	it('keeps only the freshest PU Venda per wanted bond', () => {
		const wanted = new Set([tesouroMatchKey('Tesouro IPCA+', '2032')]);
		const best = new Map<string, { price: number; date: string }>();
		ingestTesouroCsvLine(
			'Tesouro IPCA+;15/08/2032;20/08/2026;7,10;7,22;3.500,10;3.480,55;3.490,00',
			wanted,
			best
		);
		ingestTesouroCsvLine(
			'Tesouro IPCA+;15/08/2032;25/08/2026;7,05;7,17;3.520,00;3.505,42;3.512,00',
			wanted,
			best
		);
		// Different bond: ignored.
		ingestTesouroCsvLine(
			'Tesouro Prefixado;01/01/2029;26/08/2026;13,00;13,10;800,00;790,00;795,00',
			wanted,
			best
		);
		expect(best.size).toBe(1);
		expect(best.get(tesouroMatchKey('Tesouro IPCA+', '2032'))).toEqual({
			price: 3505.42,
			date: '2026-08-25'
		});
	});

	it('ignores headers and malformed lines', () => {
		const wanted = new Set([tesouroMatchKey('Tesouro IPCA+', '2032')]);
		const best = new Map<string, { price: number; date: string }>();
		ingestTesouroCsvLine(
			'Tipo Titulo;Data Vencimento;Data Base;...',
			wanted,
			best
		);
		ingestTesouroCsvLine('', wanted, best);
		ingestTesouroCsvLine(
			'Tesouro IPCA+;15/08/2032;garbage;;;;abc;',
			wanted,
			best
		);
		expect(best.size).toBe(0);
	});
});

describe('fetchBrapiQuotes', () => {
	it('maps symbols to prices and tolerates missing tickers', async () => {
		const fetcher = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				results: [
					{ symbol: 'BOVA11', regularMarketPrice: 171.82 },
					{ symbol: 'KNCR11' } // no price → skipped
				]
			})
		});
		const quotes = await fetchBrapiQuotes(
			['BOVA11', 'KNCR11'],
			fetcher as unknown as typeof fetch
		);
		expect(quotes.get('BOVA11')).toBe(171.82);
		expect(quotes.has('KNCR11')).toBe(false);
		expect(fetcher).toHaveBeenCalledWith(
			'https://brapi.dev/api/quote/BOVA11,KNCR11',
			expect.anything()
		);
	});

	it('skips the request entirely with no tickers', async () => {
		const fetcher = vi.fn();
		const quotes = await fetchBrapiQuotes(
			[],
			fetcher as unknown as typeof fetch
		);
		expect(quotes.size).toBe(0);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('throws on non-2xx so the cron reports the failure', async () => {
		const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 429 });
		await expect(
			fetchBrapiQuotes(['BOVA11'], fetcher as unknown as typeof fetch)
		).rejects.toThrow(/429/);
	});
});
