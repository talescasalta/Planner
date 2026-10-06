import { describe, expect, it } from 'vitest';
import {
	appliedSeries,
	assetMonthReturn,
	dayWindow,
	estimateMissingCdi,
	modifiedDietz,
	monthReturn,
	monthWindow,
	periodReturn,
	recentDays,
	recentMonths,
	recentYearEnds,
	recentYears,
	yearWindow
} from './investment-monthly';
import type { EventRow, QuoteRow, SnapshotRow } from './investment-positions';

function event(partial: Partial<EventRow>): EventRow {
	return {
		asset_id: 'a1',
		event_date: '2026-08-10',
		event_type: 'Transferência - Liquidação',
		direction: 'credit',
		quantity: null,
		unit_price: null,
		total_value: null,
		source: 'b3_movimentacao',
		...partial
	};
}

const snapshot = (partial: Partial<SnapshotRow> = {}): SnapshotRow => ({
	asset_id: 'a1',
	snapshot_date: '2026-07-31',
	quantity: 100,
	close_price: 10,
	net_value: 1000,
	...partial
});

const quote = (date: string, price: number, assetId = 'a1'): QuoteRow => ({
	asset_id: assetId,
	quote_date: date,
	price
});

describe('month windows', () => {
	it('opens on the last day of the previous month', () => {
		expect(monthWindow('2026-08', '2026-09-15')).toEqual({
			month: '2026-08',
			start: '2026-07-31',
			end: '2026-08-31'
		});
	});

	it('stops the running month at today', () => {
		expect(monthWindow('2026-08', '2026-08-14').end).toBe('2026-08-14');
	});

	it('crosses the year boundary backwards', () => {
		expect(monthWindow('2026-01', '2026-12-31').start).toBe('2025-12-31');
		expect(recentMonths('2026-01-15', 3)).toEqual([
			'2026-01',
			'2025-12',
			'2025-11'
		]);
	});
});

describe('day and year windows', () => {
	it('opens a day at the previous trading close', () => {
		expect(dayWindow('2026-10-02')).toEqual({
			start: '2026-10-01',
			end: '2026-10-02'
		});
		// Monday is measured from Friday.
		expect(dayWindow('2026-10-05').start).toBe('2026-10-02');
	});

	it('lists only weekdays, starting from Friday on a weekend', () => {
		expect(recentDays('2026-10-04', 3)).toEqual([
			'2026-10-02',
			'2026-10-01',
			'2026-09-30'
		]);
	});

	it('opens a year on the previous 31/12 and stops the running one today', () => {
		expect(yearWindow('2025', '2026-10-05')).toEqual({
			start: '2024-12-31',
			end: '2025-12-31'
		});
		expect(yearWindow('2026', '2026-10-05').end).toBe('2026-10-05');
		expect(recentYears('2026-10-05', '2024')).toEqual(['2026', '2025', '2024']);
		expect(recentYearEnds('2026-10-05', 2)).toEqual([
			{ from: '2025-12-15', to: '2025-12-31' },
			{ from: '2024-12-15', to: '2024-12-31' }
		]);
	});
});

describe('estimateMissingCdi', () => {
	it('fills the unpublished weekdays with the last rate', () => {
		const { rates, estimatedFrom } = estimateMissingCdi(
			[{ date: '2026-10-02', rate: 0.05 }],
			'2026-10-06'
		);
		expect(estimatedFrom).toBe('2026-10-05');
		expect(rates.map((rate) => rate.date)).toEqual([
			'2026-10-02',
			'2026-10-05',
			'2026-10-06'
		]);
		expect(rates.at(-1)!.rate).toBe(0.05);
	});

	it('does not paper over a series stuck for weeks', () => {
		const { rates } = estimateMissingCdi(
			[{ date: '2026-09-01', rate: 0.05 }],
			'2026-10-06'
		);
		expect(rates).toHaveLength(6);
	});
});

describe('periodReturn', () => {
	it('measures against an estimated CDI and flags only a stale series', () => {
		const quotes = [quote('2026-09-30', 10), quote('2026-10-06', 10.1)];
		const current = periodReturn(
			['a1'],
			'2026-10',
			monthWindow('2026-10', '2026-10-06'),
			[snapshot({ snapshot_date: '2026-09-30' })],
			[],
			quotes,
			[
				{ date: '2026-10-01', rate: 0.05 },
				{ date: '2026-10-02', rate: 0.05 }
			]
		);
		expect(current.cdiThrough).toBe('2026-10-02');
		expect(current.cdiEstimatedFrom).toBe('2026-10-05');
		expect(current.cdiStale).toBe(false);
		// Four business days of 0.05%.
		expect(current.cdiRate).toBeCloseTo(1.0005 ** 4 - 1, 10);

		const stale = periodReturn(
			['a1'],
			'2026-10',
			monthWindow('2026-10', '2026-10-31'),
			[snapshot({ snapshot_date: '2026-09-30' })],
			[],
			quotes,
			[{ date: '2026-10-01', rate: 0.05 }]
		);
		expect(stale.cdiStale).toBe(true);
	});

	it('does not report a holding that ended the period at zero', () => {
		const result = periodReturn(
			['a1'],
			'2026-10',
			monthWindow('2026-10', '2026-10-06'),
			[snapshot({ snapshot_date: '2026-10-05', quantity: 0, net_value: 0 })],
			[event({ event_date: '2026-01-10', quantity: 468 })],
			[],
			[]
		);
		expect(result.unpricedCount).toBe(0);
	});

	it('measures a single day from the previous close', () => {
		const quotes = [quote('2026-10-02', 10), quote('2026-10-05', 10.5)];
		const result = periodReturn(
			['a1'],
			'2026-10-05',
			dayWindow('2026-10-05'),
			[snapshot()],
			[],
			quotes,
			[{ date: '2026-10-05', rate: 0.05 }],
			5
		);
		expect(result.key).toBe('2026-10-05');
		expect(result.gain).toBeCloseTo(50);
		expect(result.returnRate).toBeCloseTo(0.05);
	});

	it('does not book a stale week of movement on one day', () => {
		const quotes = [quote('2026-09-25', 10), quote('2026-10-05', 11)];
		const result = periodReturn(
			['a1'],
			'2026-10-05',
			dayWindow('2026-10-05'),
			[snapshot()],
			[],
			quotes,
			[],
			5
		);
		expect(result.unpricedCount).toBe(1);
		expect(result.returnRate).toBeNull();
	});
});

describe('modifiedDietz', () => {
	const august = monthWindow('2026-08', '2026-09-01');

	it('removes contributions from the gain', () => {
		// Started at 1000, deposited 500, ended at 1560 → the gain is 60.
		const { gain } = modifiedDietz(
			1000,
			1560,
			[{ date: '2026-08-16', amount: 500 }],
			august
		);
		expect(gain).toBeCloseTo(60);
	});

	it('weights a late contribution as barely invested', () => {
		const late = modifiedDietz(
			1000,
			1560,
			[{ date: '2026-08-30', amount: 500 }],
			august
		);
		const early = modifiedDietz(
			1000,
			1560,
			[{ date: '2026-08-01', amount: 500 }],
			august
		);
		// Same gain, but money that arrived on the 30th hardly worked, so the
		// rate it earned is higher.
		expect(late.gain).toBeCloseTo(early.gain);
		expect(late.returnRate!).toBeGreaterThan(early.returnRate!);
	});

	it('matches the plain formula when nothing moved', () => {
		const { gain, returnRate } = modifiedDietz(1000, 1100, [], august);
		expect(gain).toBeCloseTo(100);
		expect(returnRate).toBeCloseTo(0.1);
	});

	it('treats income taken out as return, not as loss', () => {
		// Ended flat but paid 50 of dividends: that is a 50 gain.
		const { gain } = modifiedDietz(
			1000,
			1000,
			[{ date: '2026-08-10', amount: -50 }],
			august
		);
		expect(gain).toBeCloseTo(50);
	});

	it('reports the gain but no rate when the base is not positive', () => {
		const { gain, returnRate } = modifiedDietz(0, 0, [], august);
		expect(gain).toBe(0);
		expect(returnRate).toBeNull();
	});
});

describe('assetMonthReturn', () => {
	const rates = 0.0113; // ~1.13% in the month

	it('measures a quiet holding against the CDI', () => {
		const result = assetMonthReturn(
			'a1',
			monthWindow('2026-08', '2026-09-01'),
			[snapshot()],
			[],
			[quote('2026-07-31', 10), quote('2026-08-31', 10.5)],
			rates
		);
		expect(result.startValue).toBeCloseTo(1000);
		expect(result.endValue).toBeCloseTo(1050);
		expect(result.gain).toBeCloseTo(50);
		expect(result.returnRate).toBeCloseTo(0.05);
		// 5% against a 1.13% CDI is roughly 442% of it.
		expect(result.percentOfCdi).toBeCloseTo(442.5, 0);
	});

	it('excludes a purchase made during the month from the gain', () => {
		const result = assetMonthReturn(
			'a1',
			monthWindow('2026-08', '2026-09-01'),
			[snapshot()],
			[event({ event_date: '2026-08-15', quantity: 50, total_value: 510 })],
			[quote('2026-07-31', 10), quote('2026-08-31', 10.5)],
			rates
		);
		// 150 quotas × 10.5 = 1575, minus the 510 that came in, minus 1000.
		expect(result.endValue).toBeCloseTo(1575);
		expect(result.netFlow).toBeCloseTo(510);
		expect(result.gain).toBeCloseTo(65);
	});

	it('counts dividends as part of the month gain', () => {
		const result = assetMonthReturn(
			'a1',
			monthWindow('2026-08', '2026-09-01'),
			[snapshot()],
			[
				event({
					event_date: '2026-08-12',
					event_type: 'Rendimento',
					total_value: 30
				})
			],
			[quote('2026-07-31', 10), quote('2026-08-31', 10)],
			rates
		);
		// Price went nowhere, but R$ 30 was paid out: that is the month's return.
		expect(result.gain).toBeCloseTo(30);
	});

	// The NB0211 case: 184 cotas bought on 26/08 exist only in negociação, the
	// movimentação of the settlement month was never imported, and the position
	// file of 12/09 restates the holding at 384. Measuring across that jump
	// booked R$ 9,3 mil of aportes as a 94% month.
	const restatedSnapshots = [
		snapshot({
			snapshot_date: '2026-08-27',
			quantity: 200,
			close_price: 50.71,
			net_value: 10142
		}),
		snapshot({
			snapshot_date: '2026-09-12',
			quantity: 384,
			close_price: 51.33,
			net_value: 19710.72
		})
	];
	const restatedQuotes = [
		quote('2026-08-31', 50.79),
		quote('2026-09-12', 51.33)
	];

	it('refuses to measure a restatement the movimentação does not explain', () => {
		const result = assetMonthReturn(
			'a1',
			monthWindow('2026-09', '2026-09-17'),
			restatedSnapshots,
			[
				event({
					event_date: '2026-08-26',
					event_type: 'Compra',
					quantity: 184,
					unit_price: 50.64,
					total_value: 9317.76,
					source: 'b3_negociacao'
				})
			],
			restatedQuotes,
			rates
		);
		expect(result.divergent).toBe(true);
		expect(result.unexplainedQuantity).toBeCloseTo(184);
		expect(result.unpriced).toBe(false);
		expect(result.gain).toBe(0);
		expect(result.returnRate).toBeNull();
		expect(result.percentOfCdi).toBeNull();
	});

	it('measures normally once the settlement event arrives', () => {
		const result = assetMonthReturn(
			'a1',
			monthWindow('2026-09', '2026-09-17'),
			restatedSnapshots,
			[
				event({
					event_date: '2026-08-26',
					event_type: 'Compra',
					quantity: 184,
					unit_price: 50.64,
					total_value: 9317.76,
					source: 'b3_negociacao'
				}),
				event({
					event_date: '2026-08-28',
					quantity: 184,
					unit_price: 50.64,
					total_value: 9317.76
				})
			],
			restatedQuotes,
			rates
		);
		expect(result.divergent).toBe(false);
		expect(result.startQuantity).toBe(384);
		expect(result.endQuantity).toBe(384);
		// The purchase settled before the window opened, so it is not a flow of
		// this month: only the price moved, 50.79 → 51.33.
		expect(result.netFlow).toBe(0);
		expect(result.returnRate!).toBeCloseTo(0.0106, 4);
	});

	it('values a holding that has no quote from its snapshot, so it is not lost', () => {
		// The real LCA case: B3 prints "-" for the price, so only the value
		// exists. Reporting it as zero would hide R$ 200k from the reader.
		const result = assetMonthReturn(
			'lca',
			monthWindow('2026-08', '2026-09-01'),
			[
				snapshot({
					asset_id: 'lca',
					snapshot_date: '2026-08-27',
					quantity: 15000000,
					close_price: null,
					net_value: 154686
				})
			],
			[],
			[],
			rates
		);
		expect(result.unpriced).toBe(true);
		expect(result.endValue).toBeCloseTo(154686, 2);
	});

	it('flags an asset with no opening price instead of inventing one', () => {
		// The real LCA case: no public price series at all, only a recent mark.
		const result = assetMonthReturn(
			'lca',
			monthWindow('2026-08', '2026-09-01'),
			[snapshot({ asset_id: 'lca', snapshot_date: '2026-08-27' })],
			[],
			[quote('2026-08-27', 10, 'lca')],
			rates
		);
		expect(result.unpriced).toBe(true);
		expect(result.returnRate).toBeNull();
		expect(result.percentOfCdi).toBeNull();
	});

	it('measures a position opened during the month, which needs no opening price', () => {
		// NB0211 in the real data: first bought in August, so July has no price
		// and none is needed — it started at zero.
		const result = assetMonthReturn(
			'novo',
			monthWindow('2026-08', '2026-09-01'),
			[
				snapshot({
					asset_id: 'novo',
					snapshot_date: '2026-08-27',
					quantity: 200
				})
			],
			[
				event({
					asset_id: 'novo',
					event_date: '2026-08-26',
					quantity: 200,
					total_value: 9986
				})
			],
			[quote('2026-08-31', 50.79, 'novo')],
			rates
		);
		expect(result.unpriced).toBe(false);
		expect(result.startValue).toBe(0);
		expect(result.endValue).toBeCloseTo(10158);
		expect(result.gain).toBeCloseTo(172);
	});

	it('does not stretch a stale price across the opening mark', () => {
		// Only a June price exists: using it as the July close would book two
		// months of movement into one.
		const result = assetMonthReturn(
			'a1',
			monthWindow('2026-08', '2026-09-01'),
			[snapshot()],
			[],
			[quote('2026-06-30', 8), quote('2026-08-31', 10.5)],
			rates
		);
		expect(result.unpriced).toBe(true);
	});
});

describe('appliedSeries', () => {
	const asset = (partial = {}) => ({
		id: 'a1',
		tax_bucket: 'etf_rv' as const,
		override_quantity: null,
		override_total_cost: null,
		override_date: null,
		...partial
	});

	it('tracks money in against what it became', () => {
		const { points } = appliedSeries(
			[asset()],
			[event({ event_date: '2026-07-10', quantity: 100, total_value: 1000 })],
			[],
			[quote('2026-07-31', 11), quote('2026-08-31', 12)],
			['2026-07', '2026-08'],
			'2026-09-01'
		);
		expect(points[0]).toMatchObject({
			month: '2026-07',
			applied: 1000,
			gross: 1100
		});
		// No new money in August: applied holds, gross follows the price.
		expect(points[1]).toMatchObject({
			month: '2026-08',
			applied: 1000,
			gross: 1200
		});
	});

	it('removes the cost of what was sold, not the sale proceeds', () => {
		const { points } = appliedSeries(
			[asset()],
			[
				event({ event_date: '2026-07-10', quantity: 100, total_value: 1000 }),
				event({
					event_date: '2026-08-10',
					event_type: 'Venda',
					direction: 'debit',
					quantity: 50,
					total_value: 900
				})
			],
			[],
			[quote('2026-07-31', 10), quote('2026-08-31', 18)],
			['2026-07', '2026-08'],
			'2026-09-01'
		);
		// Sold half of a position bought at 10: applied drops by 500, the cost,
		// even though the sale brought in 900.
		expect(points[1].applied).toBeCloseTo(500);
	});

	it('counts an undated cost basis as capital already in place', () => {
		// Funds registered from a statement: the amount is known, the date is not.
		const { points } = appliedSeries(
			[asset({ override_quantity: 100, override_total_cost: 61208.05 })],
			[],
			[
				snapshot({
					snapshot_date: '2026-08-27',
					quantity: 100,
					close_price: 987.2,
					net_value: 98720
				})
			],
			[quote('2026-07-31', 950), quote('2026-08-31', 987.2)],
			['2026-07', '2026-08'],
			'2026-09-01'
		);
		expect(points[0].applied).toBeCloseTo(61208.05);
		expect(points[1].applied).toBeCloseTo(61208.05);
	});

	it('holds a dated cost basis out of the months before it', () => {
		const { points } = appliedSeries(
			[
				asset({
					override_quantity: 100,
					override_total_cost: 5000,
					override_date: '2026-08-05'
				})
			],
			[],
			[],
			[],
			['2026-07', '2026-08'],
			'2026-09-01'
		);
		expect(points[0].applied).toBe(0);
		expect(points[1].applied).toBeCloseTo(5000);
	});

	it('leaves a holding out of the whole series, not of half of it', () => {
		// The real LCA: capital that only gets a mark when a position file
		// arrives. Counting its cost while it has no price pushes the gross line
		// under the applied one and invents a loss, then a jump.
		const { points } = appliedSeries(
			[asset({ id: 'ok' }), asset({ id: 'lca' })],
			[
				event({
					asset_id: 'ok',
					event_date: '2026-06-10',
					quantity: 100,
					total_value: 1000
				}),
				event({
					asset_id: 'lca',
					event_date: '2026-06-10',
					quantity: 500,
					total_value: 5000
				})
			],
			[],
			// Only "ok" is ever priced.
			[quote('2026-07-31', 11, 'ok'), quote('2026-08-31', 12, 'ok')],
			['2026-07', '2026-08'],
			'2026-09-01'
		);
		// The R$ 5.000 of the unpriceable holding is absent from both lines, so
		// the band still reads as a real gain.
		expect(points[0]).toMatchObject({ applied: 1000, gross: 1100 });
		expect(points[1]).toMatchObject({ applied: 1000, gross: 1200 });
	});

	it('drops an asset priced only at the end, instead of drawing a cliff', () => {
		// The real August case: a position file arrives and several holdings get
		// their first price at once. Counted only from that month, the patrimony
		// appears to jump a third in thirty days.
		const series = appliedSeries(
			[asset({ id: 'ok' }), asset({ id: 'tarde' })],
			[
				event({
					asset_id: 'ok',
					event_date: '2026-06-10',
					quantity: 100,
					total_value: 1000
				}),
				event({
					asset_id: 'tarde',
					event_date: '2026-06-10',
					quantity: 200,
					total_value: 20000
				})
			],
			[],
			[
				quote('2026-07-31', 11, 'ok'),
				quote('2026-08-31', 12, 'ok'),
				// Only ever priced in the last month of the window.
				quote('2026-08-31', 150, 'tarde')
			],
			['2026-07', '2026-08'],
			'2026-09-01'
		);
		expect(series.points[0].gross).toBeCloseTo(1100);
		expect(series.points[1].gross).toBeCloseTo(1200);
		expect(series.excludedCount).toBe(1);
		expect(series.excludedValue).toBeCloseTo(30000);
	});

	it('returns the months in order regardless of how they were asked', () => {
		const { points } = appliedSeries(
			[asset()],
			[],
			[],
			[],
			['2026-08', '2026-06', '2026-07'],
			'2026-09-01'
		);
		expect(points.map((point) => point.month)).toEqual([
			'2026-06',
			'2026-07',
			'2026-08'
		]);
	});
});

describe('monthReturn', () => {
	it('weights the portfolio rate by size, not by asset count', () => {
		const snapshots = [
			snapshot({
				asset_id: 'big',
				quantity: 1000,
				net_value: 100000,
				close_price: 100
			}),
			snapshot({
				asset_id: 'small',
				quantity: 10,
				net_value: 100,
				close_price: 10
			})
		];
		const quotes = [
			quote('2026-07-31', 100, 'big'),
			quote('2026-08-31', 101, 'big'), // +1% on R$ 100k
			quote('2026-07-31', 10, 'small'),
			quote('2026-08-31', 13, 'small') // +30% on R$ 100
		];
		const result = monthReturn(
			['big', 'small'],
			'2026-08',
			'2026-09-01',
			snapshots,
			[],
			quotes,
			// 1% CDI in the month; the zero closes the series at month end, so
			// nothing is estimated.
			[
				{ date: '2026-08-15', rate: 1 },
				{ date: '2026-08-31', rate: 0 }
			]
		);
		expect(result.gain).toBeCloseTo(1030);
		// Dominated by the large holding, nowhere near the 15.5% average of both.
		expect(result.returnRate!).toBeCloseTo(0.01028, 4);
		expect(result.percentOfCdi!).toBeCloseTo(102.8, 0);
		// Best contributor first.
		expect(result.assets[0].assetId).toBe('big');
	});

	it('keeps unpriced assets out of the rate and reports their value', () => {
		const snapshots = [
			snapshot({ asset_id: 'ok' }),
			snapshot({
				asset_id: 'lca',
				snapshot_date: '2026-08-27',
				quantity: 1,
				net_value: 5000
			})
		];
		const quotes = [
			quote('2026-07-31', 10, 'ok'),
			quote('2026-08-31', 11, 'ok'),
			quote('2026-08-27', 5000, 'lca')
		];
		const result = monthReturn(
			['ok', 'lca'],
			'2026-08',
			'2026-09-01',
			snapshots,
			[],
			quotes,
			[{ date: '2026-08-15', rate: 1 }]
		);
		expect(result.gain).toBeCloseTo(100);
		expect(result.returnRate).toBeCloseTo(0.1);
		expect(result.unpricedValue).toBeCloseTo(5000);
		expect(result.unpricedCount).toBe(1);
	});

	it('keeps a divergent holding out of the rate and counts it apart', () => {
		const snapshots = [
			snapshot({ asset_id: 'ok' }),
			snapshot({
				asset_id: 'gap',
				snapshot_date: '2026-07-31',
				quantity: 200,
				close_price: 50,
				net_value: 10000
			}),
			snapshot({
				asset_id: 'gap',
				snapshot_date: '2026-08-20',
				quantity: 384,
				close_price: 50,
				net_value: 19200
			})
		];
		const quotes = [
			quote('2026-07-31', 10, 'ok'),
			quote('2026-08-31', 11, 'ok'),
			quote('2026-07-31', 50, 'gap'),
			quote('2026-08-31', 50, 'gap')
		];
		const result = monthReturn(
			['ok', 'gap'],
			'2026-08',
			'2026-09-01',
			snapshots,
			[
				event({
					asset_id: 'gap',
					event_date: '2026-08-19',
					event_type: 'Compra',
					quantity: 184,
					total_value: 9200,
					source: 'b3_negociacao'
				})
			],
			quotes,
			[{ date: '2026-08-15', rate: 1 }]
		);
		// Without the exclusion the 184 cotas would enter as R$ 9.200 of gain.
		expect(result.gain).toBeCloseTo(100);
		expect(result.returnRate).toBeCloseTo(0.1);
		expect(result.divergentCount).toBe(1);
		expect(result.divergentValue).toBeCloseTo(19200);
		expect(result.unpricedCount).toBe(0);
	});

	it('reports how far the CDI series actually reaches', () => {
		// BCB publishes with a lag, so a running month is otherwise measured
		// against a short benchmark and looks better than it is.
		const result = monthReturn(
			['a1'],
			'2026-08',
			'2026-08-31',
			[snapshot()],
			[],
			[quote('2026-07-31', 10), quote('2026-08-31', 10.5)],
			[
				{ date: '2026-08-25', rate: 0.05 },
				{ date: '2026-08-26', rate: 0.05 },
				// Nothing published for the rest of the month yet.
				{ date: '2026-09-02', rate: 0.05 }
			]
		);
		expect(result.cdiThrough).toBe('2026-08-26');
		expect(result.end).toBe('2026-08-31');
	});

	it('counts a holding with no price anywhere, which marks as zero', () => {
		// July for the LCA: the position exists (derived backwards from the
		// August snapshot) but nothing can value it, so the value is silent and
		// only the count tells the reader something is missing.
		const result = monthReturn(
			['lca'],
			'2026-07',
			'2026-08-31',
			[
				snapshot({
					asset_id: 'lca',
					snapshot_date: '2026-08-27',
					quantity: 15000000,
					close_price: null,
					net_value: 154686
				})
			],
			[],
			[],
			[{ date: '2026-07-15', rate: 1 }]
		);
		expect(result.unpricedCount).toBe(1);
		expect(result.unpricedValue).toBe(0);
		expect(result.assets[0].startQuantity).toBe(15000000);
	});
});
