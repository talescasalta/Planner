import { describe, expect, it } from 'vitest';
import { dashboardFlowKind, investmentFlowTotals } from './dashboard-flows';

const investments: { id: string; name: string; parent_id: string | null } = {
	id: 'invest',
	name: 'Investimentos',
	parent_id: null
};
const fixedIncome = { id: 'fixed', name: 'Renda fixa', parent_id: 'invest' };
const categories = new Map([
	['invest', investments],
	['fixed', fixedIncome]
]);
function flow(
	amount: number,
	category = investments,
	subcategory: typeof fixedIncome | null = null
) {
	return {
		amount,
		category,
		subcategory,
		review_status: 'confirmed',
		is_transfer: false
	};
}

describe('dashboard investment flows', () => {
	it('separates contributions and redemptions using both category representations', () => {
		expect(dashboardFlowKind(flow(-3000), categories)).toBe('contribution');
		expect(dashboardFlowKind(flow(500), categories)).toBe('redemption');
		expect(dashboardFlowKind(flow(-3000, fixedIncome), categories)).toBe(
			'contribution'
		);
		expect(
			dashboardFlowKind(flow(-3000, investments, fixedIncome), categories)
		).toBe('contribution');
	});
	it('keeps investment income and costs in operating totals', () => {
		for (const name of ['Rendimentos', 'Dividendos', 'Juros']) {
			expect(
				dashboardFlowKind(
					flow(100, investments, { ...fixedIncome, name }),
					categories
				)
			).toBe('income');
		}
		for (const name of ['Impostos', 'IOF', 'Taxas', 'Corretagem']) {
			expect(
				dashboardFlowKind(
					flow(-50, investments, { ...fixedIncome, name }),
					categories
				)
			).toBe('expense');
		}
	});
	it('ignores discarded rows and ordinary transfers but retains categorized investment transfers', () => {
		expect(
			dashboardFlowKind(
				{ ...flow(-3000), review_status: 'ignored' },
				categories
			)
		).toBe('excluded');
		expect(
			dashboardFlowKind({ ...flow(-3000), is_transfer: true }, categories)
		).toBe('contribution');
		expect(
			dashboardFlowKind(
				{ ...flow(-3000), category: null, is_transfer: true },
				categories
			)
		).toBe('excluded');
	});
	it('does not treat a large investment from old reserves as new savings', () => {
		const rows = [
			flow(10000, { ...investments, name: 'Salário' }),
			flow(-6000, { ...investments, name: 'Moradia' }),
			flow(-30000),
			flow(5000)
		];
		const operating = rows.filter((row) =>
			['income', 'expense'].includes(dashboardFlowKind(row, categories))
		);
		expect(operating.reduce((sum, row) => sum + row.amount, 0) / 10000).toBe(
			0.4
		);
		expect(investmentFlowTotals(rows, categories)).toEqual({
			contributions: 30000,
			redemptions: 5000,
			net: 25000
		});
	});
});
