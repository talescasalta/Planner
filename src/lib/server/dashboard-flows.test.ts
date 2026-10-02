import { describe, expect, it } from 'vitest';
import { dashboardFlowKind, investmentFlowTotals } from './dashboard-flows';
import type { FinancialTreatment } from '$lib/types/app';

type TestCategory = {
	id: string;
	name: string;
	parent_id: string | null;
	financial_treatment: FinancialTreatment | null;
};
const investments: TestCategory = {
	id: 'invest',
	name: 'Investimentos',
	parent_id: null,
	financial_treatment: 'investment'
};
const fixedIncome: TestCategory = {
	id: 'fixed',
	name: 'Renda fixa',
	parent_id: 'invest',
	financial_treatment: null
};
const categories = new Map<string, TestCategory>([
	['invest', investments],
	['fixed', fixedIncome]
]);
function flow(
	amount: number,
	category: TestCategory = investments,
	subcategory: TestCategory | null = null
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
	it('separates investment income from earned income and keeps costs as expenses', () => {
		for (const name of ['Rendimentos', 'Dividendos', 'Juros']) {
			expect(
				dashboardFlowKind(
					flow(100, investments, {
						...fixedIncome,
						name,
						financial_treatment: 'investment_income'
					}),
					categories
				)
			).toBe('investment_income');
		}
		for (const name of ['Impostos', 'IOF', 'Taxas', 'Corretagem']) {
			expect(
				dashboardFlowKind(
					flow(-50, investments, {
						...fixedIncome,
						name,
						financial_treatment: 'operating'
					}),
					categories
				)
			).toBe('expense');
		}
	});
	it('treats credits in consumption categories as refunds, not income', () => {
		const health: TestCategory = {
			id: 'health',
			name: 'Saúde',
			parent_id: null,
			financial_treatment: null
		};
		expect(dashboardFlowKind(flow(450, health), categories)).toBe('refund');
		expect(dashboardFlowKind(flow(-450, health), categories)).toBe('expense');
		expect(dashboardFlowKind(flow(450, null as never), categories)).toBe(
			'refund'
		);
	});
	it('keeps the sign of earned income so reversals reduce it', () => {
		const salary: TestCategory = {
			id: 'salary',
			name: 'Salário',
			parent_id: null,
			financial_treatment: 'income'
		};
		expect(dashboardFlowKind(flow(10000, salary), categories)).toBe('income');
		expect(dashboardFlowKind(flow(-300, salary), categories)).toBe('income');
	});
	it('ignores discarded rows and preserves legacy transfers as transfers', () => {
		expect(
			dashboardFlowKind(
				{ ...flow(-3000), review_status: 'ignored' },
				categories
			)
		).toBe('excluded');
		expect(
			dashboardFlowKind({ ...flow(-3000), is_transfer: true }, categories)
		).toBe('transfer');
		expect(
			dashboardFlowKind(
				{ ...flow(-3000), category: null, is_transfer: true },
				categories
			)
		).toBe('transfer');
	});
	it('does not treat a large investment from old reserves as new savings', () => {
		const rows = [
			flow(10000, {
				...investments,
				name: 'Salário',
				financial_treatment: 'income'
			}),
			flow(-6000, {
				...investments,
				name: 'Moradia',
				financial_treatment: 'operating'
			}),
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
			investmentIncome: 0,
			net: 25000,
			newCapital: 25000
		});
	});
	it('counts contributions funded by dividends as reinvestment, not new capital', () => {
		const dividends: TestCategory = {
			id: 'dividends',
			name: 'Dividendos',
			parent_id: null,
			financial_treatment: 'investment_income'
		};
		const rows = [flow(2000, dividends), flow(-2000)];
		expect(investmentFlowTotals(rows, categories)).toEqual({
			contributions: 2000,
			redemptions: 0,
			investmentIncome: 2000,
			net: 2000,
			newCapital: 0
		});
	});
});
