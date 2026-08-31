import { describe, expect, it } from 'vitest';
import {
	assetMonthReturn,
	modifiedDietz,
	monthReturn,
	monthWindow,
	recentMonths
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
			[{ date: '2026-08-15', rate: 1 }] // 1% CDI in the month
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
