import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import { brazilToday } from './brazil-date';
import {
	collectTesouroUpserts,
	fetchTesouroLiveQuotes,
	fetchTickerQuotes,
	parseTesouroLive,
	priceFromYahooChart,
	ingestTesouroCsvLine,
	tesouroKeyFromProductName,
	tesouroMatchKey
} from './investment-quotes';

describe('brazilToday', () => {
	it('keeps the Brasília date after 21h, when UTC has already turned', () => {
		expect(brazilToday(new Date('2026-10-06T01:30:00Z'))).toBe('2026-10-05');
		expect(brazilToday(new Date('2026-10-05T21:00:00Z'))).toBe('2026-10-05');
	});
});

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

	it('maps Renda+ conversion years to the bond maturity year', () => {
		expect(
			tesouroKeyFromProductName('TESOURO RENDA+ APOSENTADORIA EXTRA 2065')
		).toBe(tesouroMatchKey('Tesouro Renda+ Aposentadoria Extra', '2084'));
		expect(
			tesouroKeyFromProductName(
				'TESOURO RENDA+ APOSENTADORIA EXTRA 2055',
				'2074-12-15'
			)
		).toBe(tesouroMatchKey('Tesouro Renda+ Aposentadoria Extra', '2074'));
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

describe('tesouro live feed', () => {
	const bond = (over: Record<string, unknown> = {}) => ({
		treasuryBondName: 'Tesouro IPCA+ 2032',
		maturityDate: '2032-08-15T00:00',
		unitaryRedemptionValue: 3183.68,
		lastMarketPricingDate: '2026-10-05T18:00:05.677',
		...over
	});

	it('keys bonds like the CSV and dates them by the pricing date', () => {
		const wanted = new Set([
			tesouroMatchKey('Tesouro IPCA+', '2032'),
			tesouroMatchKey('Tesouro Renda+ Aposentadoria Extra', '2074')
		]);
		const live = parseTesouroLive(
			{
				TesouroLegado: [
					bond(),
					bond({
						treasuryBondName: 'Tesouro Renda+ Aposentadoria Extra 2055',
						maturityDate: '2074-12-15T00:00',
						unitaryRedemptionValue: 456.86
					}),
					bond({ treasuryBondName: 'Tesouro Selic 2027' })
				]
			},
			wanted
		);
		expect(live.get(tesouroMatchKey('Tesouro IPCA+', '2032'))).toEqual({
			price: 3183.68,
			date: '2026-10-05'
		});
		expect(
			live.get(tesouroMatchKey('Tesouro Renda+ Aposentadoria Extra', '2074'))
				?.price
		).toBe(456.86);
		expect(live.size).toBe(2);
	});

	it('skips unusable entries and unexpected payloads', () => {
		const wanted = new Set([tesouroMatchKey('Tesouro IPCA+', '2032')]);
		expect(
			parseTesouroLive(
				{
					TesouroLegado: [
						bond({ unitaryRedemptionValue: 0 }),
						bond({ unitaryRedemptionValue: '3183' }),
						bond({ lastMarketPricingDate: 'ontem' })
					]
				},
				wanted
			).size
		).toBe(0);
		expect(parseTesouroLive(null, wanted).size).toBe(0);
		expect(parseTesouroLive({ TesouroLegado: 'x' }, wanted).size).toBe(0);
	});

	it('fails loudly on a non-OK response so the CSV carries the run', async () => {
		const fetcher = vi.fn(async () => ({ ok: false, status: 410 }));
		await expect(
			fetchTesouroLiveQuotes(new Set(), fetcher as unknown as typeof fetch)
		).rejects.toThrow('410');
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

describe('tesouro source order', () => {
	const asset = (id: string, product: string, maturity: string) =>
		({
			id,
			household_id: 'h1',
			asset_class: 'tesouro',
			ticker: null,
			product_key: `TESOURO:${product}`,
			maturity_date: maturity,
			index_type: null,
			index_percent: null,
			index_spread: null
		}) as Parameters<typeof collectTesouroUpserts>[0][number];
	const assets = [
		asset('a1', 'TESOURO IPCA+ 2032', '2032-08-15'),
		asset('a2', 'TESOURO PREFIXADO 2026', '2026-01-01')
	];
	const feed = {
		TesouroLegado: [
			{
				treasuryBondName: 'Tesouro IPCA+ 2032',
				maturityDate: '2032-08-15T00:00',
				unitaryRedemptionValue: 3183.68,
				lastMarketPricingDate: '2026-10-05T18:00:05.677'
			}
		]
	};
	const csv = [
		'Tesouro IPCA+;15/08/2032;02/10/2026;7,10;7,22;3.500,10;3.077,06;3.490,00',
		'Tesouro Prefixado;01/01/2026;30/12/2025;13,00;13,10;800,00;998,88;795,00'
	].join('\n');

	function run(feedResponse: () => Response) {
		const fetcher = vi.fn(async (url: string | URL | Request) =>
			String(url).includes('tesourodireto.com.br')
				? feedResponse()
				: new Response(csv)
		);
		const summary = { errors: [] as string[], tesouroQuotes: 0 };
		return {
			fetcher,
			summary,
			upserts: collectTesouroUpserts(
				assets,
				summary as Parameters<typeof collectTesouroUpserts>[1],
				fetcher as unknown as typeof fetch
			)
		};
	}
	const csvCalls = (fetcher: ReturnType<typeof run>['fetcher']) =>
		fetcher.mock.calls.filter(
			([url]) => !String(url).includes('tesourodireto.com.br')
		).length;

	it('prefers the live feed and falls back to the CSV for bonds it lacks', async () => {
		const { upserts, summary, fetcher } = run(
			() => new Response(JSON.stringify(feed))
		);
		const rows = await upserts;
		expect(rows.map((r) => [r.asset_id, r.quote_date, r.price])).toEqual([
			['a1', '2026-10-05', 3183.68],
			['a2', '2025-12-30', 998.88]
		]);
		expect(summary.errors).toEqual([]);
		expect(csvCalls(fetcher)).toBe(1);
	});

	it('does not download the CSV when the feed covers every bond', async () => {
		const fetcher = vi.fn(async () => new Response(JSON.stringify(feed)));
		const rows = await collectTesouroUpserts(
			[assets[0]],
			{ errors: [] } as unknown as Parameters<typeof collectTesouroUpserts>[1],
			fetcher as unknown as typeof fetch
		);
		expect(rows).toHaveLength(1);
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('uses the CSV for everything when the feed is gone', async () => {
		const { upserts, summary } = run(
			() => new Response('gone', { status: 410 })
		);
		const rows = await upserts;
		expect(rows.map((r) => [r.asset_id, r.quote_date, r.price])).toEqual([
			['a1', '2026-10-02', 3077.06],
			['a2', '2025-12-30', 998.88]
		]);
		expect(summary.errors).toEqual([
			'tesouro direto: Tesouro Direto respondeu 410'
		]);
	});
});
