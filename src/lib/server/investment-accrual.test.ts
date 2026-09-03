import { describe, expect, it } from 'vitest';
import {
	accrualSeries,
	accrualSteps,
	dailyFactor,
	impliedCdiPercent,
	isAccruable
} from './investment-accrual';
import type { CdiRate } from './investment-returns';

// A flat CDI of 0.05% per business day, which is roughly where a 13%-a.a.
// Selic sits, over ten business days.
const flatCdi = (days: number, rate = 0.05): CdiRate[] =>
	Array.from({ length: days }, (_, index) => ({
		date: `2026-09-${String(index + 1).padStart(2, '0')}`,
		rate
	}));

describe('isAccruable', () => {
	it('accepts the indexers this app holds a series for', () => {
		expect(isAccruable({ indexType: 'cdi', percent: 96, spread: null })).toBe(
			true
		);
		expect(isAccruable({ indexType: 'pre', percent: 12, spread: null })).toBe(
			true
		);
	});

	it('refuses what it cannot compute rather than inventing it', () => {
		expect(isAccruable(null)).toBe(false);
		expect(isAccruable({ indexType: 'ipca', percent: 6, spread: null })).toBe(
			false
		);
		expect(isAccruable({ indexType: 'cdi', percent: null, spread: null })).toBe(
			false
		);
		expect(isAccruable({ indexType: 'cdi', percent: 0, spread: null })).toBe(
			false
		);
	});
});

describe('dailyFactor', () => {
	it('scales the published daily rate by the percentage of CDI', () => {
		// 96% of a 0.05% day is 0.048%.
		expect(
			dailyFactor({ indexType: 'cdi', percent: 96, spread: null }, 0.05)
		).toBeCloseTo(1.00048, 10);
	});

	it('treats 100% of CDI as the CDI itself', () => {
		expect(
			dailyFactor({ indexType: 'cdi', percent: 100, spread: null }, 0.05)
		).toBeCloseTo(1.0005, 10);
	});

	it('takes the 252nd root of an annual prefixado rate', () => {
		const factor = dailyFactor(
			{ indexType: 'pre', percent: 12, spread: null },
			0
		);
		expect(factor ** 252).toBeCloseTo(1.12, 10);
	});

	it('compounds a spread on top of the index, annualized', () => {
		const withSpread = dailyFactor(
			{ indexType: 'cdi', percent: 100, spread: 1.2 },
			0.05
		);
		const plain = dailyFactor(
			{ indexType: 'cdi', percent: 100, spread: null },
			0.05
		);
		expect(withSpread).toBeGreaterThan(plain);
		expect((withSpread / plain) ** 252).toBeCloseTo(1.012, 10);
	});
});

describe('accrualSeries', () => {
	it('starts the day after the anchor and compounds each business day', () => {
		const series = accrualSeries(
			{ date: '2026-09-01', price: 100 },
			{ indexType: 'cdi', percent: 100, spread: null },
			flatCdi(4),
			'2026-09-04'
		);

		expect(series.map((point) => point.date)).toEqual([
			'2026-09-02',
			'2026-09-03',
			'2026-09-04'
		]);
		expect(series[0].price).toBeCloseTo(100 * 1.0005, 10);
		expect(series[2].price).toBeCloseTo(100 * 1.0005 ** 3, 10);
	});

	it('stops at the requested date and ignores days before the anchor', () => {
		const series = accrualSeries(
			{ date: '2026-09-02', price: 100 },
			{ indexType: 'cdi', percent: 100, spread: null },
			flatCdi(6),
			'2026-09-04'
		);

		expect(series.map((point) => point.date)).toEqual([
			'2026-09-03',
			'2026-09-04'
		]);
	});

	it('produces nothing when the rate cannot be accrued', () => {
		expect(
			accrualSeries(
				{ date: '2026-09-01', price: 100 },
				{ indexType: 'ipca', percent: 6, spread: null },
				flatCdi(4),
				'2026-09-04'
			)
		).toEqual([]);
	});

	it('produces nothing when no business day has passed yet', () => {
		expect(
			accrualSeries(
				{ date: '2026-09-04', price: 100 },
				{ indexType: 'cdi', percent: 96, spread: null },
				flatCdi(4),
				'2026-09-04'
			)
		).toEqual([]);
	});
});

describe('impliedCdiPercent', () => {
	it('recovers the percentage that produced a growth', () => {
		const rates = flatCdi(10);
		const series = accrualSeries(
			{ date: '2026-09-01', price: 100 },
			{ indexType: 'cdi', percent: 91.5, spread: null },
			rates,
			'2026-09-10'
		);
		const last = series[series.length - 1];

		const implied = impliedCdiPercent(
			{ date: '2026-09-01', price: 100 },
			last,
			rates
		);

		expect(implied).toBeCloseTo(91.5, 4);
	});

	it('returns null when the pair cannot answer', () => {
		const rates = flatCdi(10);
		expect(
			impliedCdiPercent(
				{ date: '2026-09-05', price: 100 },
				{ date: '2026-09-01', price: 101 },
				rates
			)
		).toBeNull();
		expect(
			impliedCdiPercent(
				{ date: '2026-09-01', price: 100 },
				{ date: '2026-09-02', price: 500 },
				rates
			)
		).toBeNull();
	});
});

// The convention, pinned with rates that differ by day so a one-day shift
// changes the answer. While the CDI is flat — as it is for long stretches —
// getting this backwards is invisible, which is exactly why it needs a test.
describe('accrual dating', () => {
	const varying = [
		{ date: '2026-09-01', rate: 1 },
		{ date: '2026-09-02', rate: 2 },
		{ date: '2026-09-03', rate: 4 }
	];

	it('carries a day with the rate published the business day before', () => {
		const steps = accrualSteps(varying, '2026-09-01', '2026-09-03');

		expect(steps).toEqual([
			{ date: '2026-09-02', rate: 1 },
			{ date: '2026-09-03', rate: 2 }
		]);
	});

	it('compounds the price with the previous day rate, not the landing one', () => {
		const series = accrualSeries(
			{ date: '2026-09-01', price: 100 },
			{ indexType: 'cdi', percent: 100, spread: null },
			varying,
			'2026-09-03'
		);

		// 100 × 1.01 (rate of 09-01) × 1.02 (rate of 09-02).
		expect(series[0].price).toBeCloseTo(101, 10);
		expect(series[1].price).toBeCloseTo(103.02, 10);
	});

	// The newest published rate remunerates a day that has not arrived yet.
	it('leaves the last published rate unused', () => {
		const steps = accrualSteps(varying, '2026-09-01', '2026-09-30');

		expect(steps.at(-1)).toEqual({ date: '2026-09-03', rate: 2 });
	});

	it('recovers the implied rate under the same dating', () => {
		const implied = impliedCdiPercent(
			{ date: '2026-09-01', price: 100 },
			{ date: '2026-09-03', price: 103.02 },
			varying
		);

		expect(implied).toBeCloseTo(100, 6);
	});
});
