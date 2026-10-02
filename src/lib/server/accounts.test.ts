import { describe, expect, it } from 'vitest';
import {
	NO_ACCOUNT_LABEL,
	buildCoverage,
	normalizeAccountName
} from './accounts';

const rowIn = (source_name: string | null, reference_month: string) => ({
	source_name,
	reference_month
});

function states(
	coverage: ReturnType<typeof buildCoverage>,
	account: string
): Record<string, string> {
	const row = coverage.rows.find((r) => r.account === account);
	return Object.fromEntries(row?.cells.map((c) => [c.month, c.state]) ?? []);
}

describe('normalizeAccountName', () => {
	it('trims, collapses spaces and bounds the length', () => {
		expect(normalizeAccountName('  Itaú   conta ')).toBe('Itaú conta');
		expect(normalizeAccountName(null)).toBe('');
		expect(normalizeAccountName('x'.repeat(200))).toHaveLength(60);
	});
});

describe('buildCoverage', () => {
	it('lists the twelve months ending at the current one, oldest first', () => {
		const { months } = buildCoverage([], '2026-10');

		expect(months).toHaveLength(12);
		expect(months[0]).toBe('2025-11');
		expect(months[11]).toBe('2026-10');
	});

	it('flags a closed month with no rows between months that have data', () => {
		const rows = [
			...['2026-04', '2026-05', '2026-07', '2026-08', '2026-09'].map((month) =>
				rowIn('Nubank conta', month)
			),
			rowIn('Itaú conta', '2026-08'),
			rowIn('Itaú conta', '2026-09')
		];

		const coverage = buildCoverage(rows, '2026-10');
		const nubank = states(coverage, 'Nubank conta');

		expect(nubank['2026-06']).toBe('gap');
		expect(nubank['2026-05']).toBe('ok');
		// Before the account's first month there is nothing to expect.
		expect(nubank['2026-03']).toBe('none');
		// The running month is not a gap until it closes.
		expect(nubank['2026-10']).toBe('none');
		expect(states(coverage, 'Itaú conta')['2026-07']).toBe('none');
	});

	it('flags closed months after an account stopped importing', () => {
		const coverage = buildCoverage(
			[rowIn('Nubank cartão', '2026-07')],
			'2026-10'
		);

		expect(states(coverage, 'Nubank cartão')).toMatchObject({
			'2026-07': 'ok',
			'2026-08': 'gap',
			'2026-09': 'gap',
			'2026-10': 'none'
		});
	});

	it('counts rows per month and ignores months outside the window', () => {
		const coverage = buildCoverage(
			[
				rowIn('Itaú conta', '2026-09'),
				rowIn('Itaú conta', '2026-09'),
				rowIn('Itaú conta', '2024-01'),
				{ source_name: 'Itaú conta', reference_month: null }
			],
			'2026-10'
		);
		const cells = coverage.rows[0].cells;

		expect(cells.find((c) => c.month === '2026-09')?.count).toBe(2);
		expect(coverage.rows).toHaveLength(1);
	});

	it('files rows without an account under a fallback row listed last', () => {
		const coverage = buildCoverage(
			[rowIn(null, '2026-09'), rowIn('Vale refeição', '2026-09')],
			'2026-10'
		);

		expect(coverage.rows.map((r) => r.account)).toEqual([
			'Vale refeição',
			NO_ACCOUNT_LABEL
		]);
	});

	it('crosses a year boundary when building the window', () => {
		const { months } = buildCoverage([], '2026-02');

		expect(months[0]).toBe('2025-03');
		expect(months).toContain('2025-12');
		expect(months).toContain('2026-01');
	});
});
