import { describe, expect, it } from 'vitest';
import {
	financialFlowKind,
	resolveFinancialTreatment,
	summarizeFinancialFlows
} from './financial-treatment';

type Category = {
	id: string;
	name: string;
	parent_id: string | null;
	financial_treatment: 'operating' | 'investment' | 'transfer' | null;
};

const investment: Category = {
	id: 'investment',
	name: 'Carteira',
	parent_id: null,
	financial_treatment: 'investment'
};
const child: Category = {
	id: 'child',
	name: 'ETF',
	parent_id: 'investment',
	financial_treatment: null
};
const operatingChild: Category = {
	id: 'operating-child',
	name: 'Rendimentos',
	parent_id: 'investment',
	financial_treatment: 'operating'
};
const categories = new Map<string, Category>([
	[investment.id, investment],
	[child.id, child],
	[operatingChild.id, operatingChild]
]);

describe('financial treatment', () => {
	it('uses the documented precedence and keeps the legacy transfer compatible', () => {
		expect(
			resolveFinancialTreatment(
				{
					amount: -100,
					is_transfer: true,
					financial_treatment_override: 'investment',
					category: investment
				},
				categories
			)
		).toBe('investment');
		expect(
			resolveFinancialTreatment(
				{ amount: -100, is_transfer: true, category: investment },
				categories
			)
		).toBe('transfer');
		expect(
			resolveFinancialTreatment({ amount: -100, category: child }, categories)
		).toBe('investment');
		expect(
			resolveFinancialTreatment(
				{ amount: -100, category: investment, subcategory: operatingChild },
				categories
			)
		).toBe('operating');
		expect(
			financialFlowKind({ amount: -100, review_status: 'ignored' }, categories)
		).toBe('excluded');
	});

	it('does not infer treatment from a renamed category', () => {
		expect(
			financialFlowKind(
				{
					amount: -100,
					category: {
						id: 'renamed',
						name: 'Investimentos',
						parent_id: null,
						financial_treatment: null
					}
				},
				new Map()
			)
		).toBe('expense');
	});

	it('aggregates budget and investment flows in cents', () => {
		const totals = summarizeFinancialFlows(
			[
				{
					amount: 10000,
					category: { ...investment, financial_treatment: 'operating' }
				},
				{
					amount: -6000,
					category: { ...investment, financial_treatment: 'operating' }
				},
				{ amount: -3000, category: investment },
				{ amount: 1000, category: investment },
				{ amount: -500, is_transfer: true },
				{ amount: -700, review_status: 'ignored' }
			],
			categories
		);
		expect(totals).toEqual({
			income: 10000,
			expense: 6000,
			contribution: 3000,
			redemption: 1000,
			transfer: 500,
			count: 5
		});
		expect(totals.income - totals.expense).toBe(4000);
	});
});
