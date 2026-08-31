import { describe, expect, it } from 'vitest';
import {
	annualize,
	buildCashFlows,
	cdiFactor,
	compareToCdi,
	twrSeries,
	valuationSeries,
	xirr,
	type CdiRate
} from './investment-returns';
import type { EventRow } from './investment-positions';

function event(partial: Partial<EventRow>): EventRow {
	return {
		asset_id: 'a1',
		event_date: '2026-01-10',
		event_type: 'Transferência - Liquidação',
		direction: 'credit',
		quantity: null,
		unit_price: null,
		total_value: null,
		source: 'b3_movimentacao',
		...partial
	};
}

describe('xirr', () => {
	it('solves the textbook one-year case', () => {
		const rate = xirr([
			{ date: '2026-01-01', amount: -1000 },
			{ date: '2027-01-01', amount: 1100 }
		]);
		expect(rate).toBeCloseTo(0.1, 6);
	});

	it('handles contributions spread over time', () => {
		// R$ 1.000 at the start, R$ 1.000 halfway, worth R$ 2.200 after a year.
		const rate = xirr([
			{ date: '2026-01-01', amount: -1000 },
			{ date: '2026-07-02', amount: -1000 },
			{ date: '2027-01-01', amount: 2200 }
		]);
		// Between the 10% earned by the full-year money and the ~20% the
		// half-year money would need — the money-weighted answer sits above 10%.
		expect(rate).toBeGreaterThan(0.1);
		expect(rate).toBeLessThan(0.2);
	});

	it('reports losses as negative rates', () => {
		const rate = xirr([
			{ date: '2026-01-01', amount: -1000 },
			{ date: '2027-01-01', amount: 800 }
		]);
		expect(rate).toBeCloseTo(-0.2, 6);
	});

	it('refuses to guess when money only moves one way', () => {
		expect(
			xirr([
				{ date: '2026-01-01', amount: -1000 },
				{ date: '2026-06-01', amount: -500 }
			])
		).toBeNull();
		expect(xirr([{ date: '2026-01-01', amount: -1000 }])).toBeNull();
	});
});

describe('buildCashFlows', () => {
	const asset = (
		id: string,
		override?: Partial<{ q: number; c: number; d: string }>
	) => ({
		id,
		override_quantity: override?.q ?? null,
		override_total_cost: override?.c ?? null,
		override_date: override?.d ?? null
	});

	it('signs buys as money in and sales/income as money out', () => {
		const { flows } = buildCashFlows(
			[asset('a1')],
			[
				event({ event_date: '2026-01-10', total_value: 1000 }),
				event({
					event_date: '2026-03-10',
					event_type: 'Rendimento',
					total_value: 50
				}),
				event({
					event_date: '2026-04-10',
					event_type: 'Vencimento',
					direction: 'debit',
					quantity: 10,
					total_value: 600
				}),
				event({
					event_date: '2026-05-10',
					event_type: 'Cobrança de Taxa Semestral',
					direction: 'debit',
					total_value: 5
				})
			],
			new Map([['a1', 500]]),
			'2026-08-27'
		);
		expect(flows).toEqual([
			{ date: '2026-01-10', amount: -1000 },
			{ date: '2026-03-10', amount: 50 },
			{ date: '2026-04-10', amount: 600 },
			{ date: '2026-05-10', amount: -5 },
			{ date: '2026-08-27', amount: 500 }
		]);
	});

	it('excludes assets transferred in without a recorded value', () => {
		// Broker migrations arrive as a Transferência credit with no value,
		// which would make the holding look free and inflate returns.
		const { flows, excludedAssetIds } = buildCashFlows(
			[asset('bova'), asset('kncr')],
			[
				event({
					asset_id: 'bova',
					event_date: '2024-02-01',
					event_type: 'Transferência',
					quantity: 170,
					total_value: null
				}),
				event({ asset_id: 'kncr', event_date: '2026-01-10', total_value: 1000 })
			],
			new Map([
				['bova', 29209.4],
				['kncr', 1200]
			]),
			'2026-08-27'
		);
		expect(excludedAssetIds).toEqual(['bova']);
		// Only kncr's purchase and current value survive.
		expect(flows).toEqual([
			{ date: '2026-01-10', amount: -1000 },
			{ date: '2026-08-27', amount: 1200 }
		]);
	});

	it('excludes a holding that exists only in the position file', () => {
		// The real LCA case: worth R$ 45k today with no event at all, because it
		// was acquired before the available movimentação history.
		const { flows, excludedAssetIds } = buildCashFlows(
			[asset('lca')],
			[],
			new Map([['lca', 45362.55]]),
			'2026-08-27'
		);
		expect(excludedAssetIds).toEqual(['lca']);
		expect(flows).toEqual([]);
	});

	it('excludes a transferred asset even when it also has priced purchases', () => {
		// BOVA11 in the real data: bought normally over the years, but part of
		// the position arrived free through a broker migration. Its cost is only
		// partly known, so the whole holding stays out.
		const { excludedAssetIds } = buildCashFlows(
			[asset('bova')],
			[
				event({
					asset_id: 'bova',
					event_date: '2022-01-10',
					total_value: 5000
				}),
				event({
					asset_id: 'bova',
					event_date: '2024-02-01',
					event_type: 'Transferência',
					quantity: 170,
					total_value: null
				})
			],
			new Map([['bova', 29209.4]]),
			'2026-08-27'
		);
		expect(excludedAssetIds).toEqual(['bova']);
	});

	it('excludes an asset whose events never carry an acquisition amount', () => {
		// The real NUIF11 case: dozens of events, none of them a priced entry.
		const { excludedAssetIds } = buildCashFlows(
			[asset('nuif')],
			[
				event({
					asset_id: 'nuif',
					event_date: '2025-05-10',
					event_type: 'Rendimento',
					total_value: 300
				}),
				event({
					asset_id: 'nuif',
					event_date: '2025-06-10',
					event_type: 'Atualização',
					quantity: 468,
					total_value: null
				})
			],
			new Map([['nuif', 39756.6]]),
			'2026-08-27'
		);
		expect(excludedAssetIds).toEqual(['nuif']);
	});

	it('a manual cost override rescues a transferred asset', () => {
		const { flows, excludedAssetIds } = buildCashFlows(
			[asset('bova', { q: 170, c: 20000, d: '2024-02-01' })],
			[
				event({
					asset_id: 'bova',
					event_date: '2024-02-01',
					event_type: 'Transferência',
					quantity: 170,
					total_value: null
				})
			],
			new Map([['bova', 29209.4]]),
			'2026-08-27'
		);
		expect(excludedAssetIds).toEqual([]);
		expect(flows).toEqual([
			{ date: '2024-02-01', amount: -20000 },
			{ date: '2026-08-27', amount: 29209.4 }
		]);
	});

	it('ignores negociação rows so trades are not counted twice', () => {
		const { flows } = buildCashFlows(
			[asset('a1')],
			[
				event({ event_date: '2026-01-10', total_value: 1000 }),
				event({
					event_date: '2026-01-10',
					event_type: 'Compra',
					total_value: 1000,
					source: 'b3_negociacao'
				})
			],
			new Map([['a1', 1100]]),
			'2026-08-27'
		);
		expect(flows.filter((f) => f.amount === -1000)).toHaveLength(1);
	});
});

describe('CDI accumulation', () => {
	it('compounds the daily rates inside the window', () => {
		const rates: CdiRate[] = [
			{ date: '2026-01-01', rate: 99 }, // before the window: ignored
			{ date: '2026-01-02', rate: 0.05 },
			{ date: '2026-01-03', rate: 0.05 },
			{ date: '2026-01-04', rate: 99 } // after the window: ignored
		];
		expect(cdiFactor(rates, '2026-01-01', '2026-01-03')).toBeCloseTo(
			1.0005 * 1.0005,
			10
		);
	});

	it('annualizes a factor over its own period', () => {
		expect(annualize(1.12, '2026-01-01', '2027-01-01')).toBeCloseTo(0.12, 6);
		// 182 days at 1.12 compounds to 1.12^(365/182) - 1 a year.
		expect(annualize(1.12, '2026-01-01', '2026-07-02')).toBeCloseTo(
			Math.pow(1.12, 365 / 182) - 1,
			10
		);
		expect(annualize(1.1, '2026-01-01', '2026-01-01')).toBeNull();
	});

	it('expresses the portfolio as a percentage of CDI', () => {
		// Synthetic single-day rate chosen so the window compounds to exactly
		// 1.12, i.e. a 12% a.a. CDI.
		const rates: CdiRate[] = [{ date: '2026-06-01', rate: 12 }];
		const comparison = compareToCdi(0.14, rates, '2026-01-01', '2027-01-01')!;
		expect(comparison.cdiAnnual).toBeCloseTo(0.12, 6);
		expect(comparison.percentOfCdi).toBeCloseTo(116.667, 2);
	});

	it('does not divide by a non-positive CDI', () => {
		const comparison = compareToCdi(0.1, [], '2026-01-01', '2027-01-01')!;
		expect(comparison.cdiAnnual).toBe(0);
		expect(comparison.percentOfCdi).toBeNull();
	});
});

describe('valuationSeries', () => {
	const snapshots = [
		{
			asset_id: 'a1',
			snapshot_date: '2026-08-27',
			quantity: 100,
			close_price: 10,
			net_value: 1000
		}
	];
	const quotes = [
		{ asset_id: 'a1', quote_date: '2026-08-27', price: 10 },
		{ asset_id: 'a1', quote_date: '2026-08-28', price: 11 }
	];

	it('values each date with that date quantities and quote', () => {
		const points = valuationSeries(['a1'], snapshots, [], quotes, [
			'2026-08-28',
			'2026-08-27'
		]);
		expect(points.map((p) => p.date)).toEqual(['2026-08-27', '2026-08-28']);
		expect(points[0].totalValue).toBe(1000);
		expect(points[1].totalValue).toBe(1100);
	});

	it('carries the last known quote forward on days without one', () => {
		const points = valuationSeries(['a1'], snapshots, [], quotes, [
			'2026-08-29'
		]);
		expect(points[0].totalValue).toBe(1100);
	});

	it('reflects a purchase in both the value and the day net flow', () => {
		const purchase = event({
			event_date: '2026-08-28',
			event_type: 'Transferência - Liquidação',
			quantity: 10,
			total_value: 110
		});
		const points = valuationSeries(['a1'], snapshots, [purchase], quotes, [
			'2026-08-28'
		]);
		// 110 quotas × 11, and the 110 that came in is flow, not performance.
		expect(points[0].totalValue).toBe(1210);
		expect(points[0].netFlow).toBe(110);
	});

	it('treats income as money leaving the portfolio', () => {
		const dividend = event({
			event_date: '2026-08-28',
			event_type: 'Rendimento',
			total_value: 50
		});
		const points = valuationSeries(['a1'], snapshots, [dividend], quotes, [
			'2026-08-28'
		]);
		expect(points[0].netFlow).toBe(-50);
	});
});

describe('twrSeries', () => {
	it('neutralizes contributions so they do not read as performance', () => {
		const points = twrSeries(
			[
				{ date: '2026-01-01', totalValue: 1000, netFlow: 0 },
				{ date: '2026-01-02', totalValue: 1100, netFlow: 0 },
				// R$ 500 deposited: value jumps to 1650, but only 50 of that is gain.
				{ date: '2026-01-03', totalValue: 1650, netFlow: 500 }
			],
			[]
		);
		expect(points[0].portfolioIndex).toBe(100);
		expect(points[1].portfolioIndex).toBeCloseTo(110, 6);
		expect(points[2].portfolioIndex).toBeCloseTo(115, 6);
	});

	it('tracks the CDI index alongside on the same dates', () => {
		const points = twrSeries(
			[
				{ date: '2026-01-01', totalValue: 1000, netFlow: 0 },
				{ date: '2026-01-03', totalValue: 1020, netFlow: 0 }
			],
			[
				{ date: '2026-01-02', rate: 0.05 },
				{ date: '2026-01-03', rate: 0.05 }
			]
		);
		expect(points[1].portfolioIndex).toBeCloseTo(102, 6);
		expect(points[1].cdiIndex).toBeCloseTo(100 * 1.0005 * 1.0005, 8);
	});

	it('returns nothing without valuations', () => {
		expect(twrSeries([], [])).toEqual([]);
	});
});
