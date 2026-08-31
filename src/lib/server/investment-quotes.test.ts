import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
	fetchTickerQuotes,
	priceFromYahooChart,
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

function yahooChart(price: number | null) {
	return {
		ok: true,
		json: async () => ({
			chart: {
				result: [{ meta: price === null ? {} : { regularMarketPrice: price } }]
			}
		})
	};
}

describe('fetchTickerQuotes', () => {
	it('queries Yahoo per ticker with the .SA suffix', async () => {
		const fetcher = vi.fn().mockResolvedValue(yahooChart(171.82));
		const { quotes } = await fetchTickerQuotes(
			['BOVA11'],
			fetcher as unknown as typeof fetch
		);
		expect(quotes.get('BOVA11')).toBe(171.82);
		expect(fetcher).toHaveBeenCalledWith(
			'https://query1.finance.yahoo.com/v8/finance/chart/BOVA11.SA?range=1d&interval=1d',
			expect.anything()
		);
	});

	it('keeps going when one ticker fails, reporting it', async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 404 })
			.mockResolvedValueOnce(yahooChart(107))
			.mockResolvedValueOnce(yahooChart(null));
		const { quotes, failures } = await fetchTickerQuotes(
			['DELISTED11', 'KNCR11', 'SEMPRECO11'],
			fetcher as unknown as typeof fetch
		);
		expect(quotes.get('KNCR11')).toBe(107);
		expect(quotes.size).toBe(1);
		expect(failures).toEqual(['DELISTED11 (404)', 'SEMPRECO11 (sem preço)']);
	});

	it('survives a thrown network error', async () => {
		const fetcher = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
		const { quotes, failures } = await fetchTickerQuotes(
			['BOVA11'],
			fetcher as unknown as typeof fetch
		);
		expect(quotes.size).toBe(0);
		expect(failures).toEqual(['BOVA11 (ECONNRESET)']);
	});

	it('skips the request entirely with no tickers', async () => {
		const fetcher = vi.fn();
		const { quotes } = await fetchTickerQuotes(
			[],
			fetcher as unknown as typeof fetch
		);
		expect(quotes.size).toBe(0);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('rejects non-positive or missing prices', () => {
		expect(
			priceFromYahooChart({ chart: { result: [{ meta: {} }] } })
		).toBeNull();
		expect(
			priceFromYahooChart({
				chart: { result: [{ meta: { regularMarketPrice: 0 } }] }
			})
		).toBeNull();
		expect(priceFromYahooChart({})).toBeNull();
		expect(
			priceFromYahooChart({
				chart: { result: [{ meta: { regularMarketPrice: 12.5 } }] }
			})
		).toBe(12.5);
	});
});
