import { describe, expect, it } from 'vitest';
import {
	financialFlowKind,
	flowMatchesFilter,
	isFlowFilter,
	resolveFinancialTreatment,
	summarizeFinancialFlows
} from './financial-treatment';
import type { FinancialTreatment } from '$lib/types/app';

type Category = {
	id: string;
	name: string;
	parent_id: string | null;
	financial_treatment: FinancialTreatment | null;
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

	it('lets the spending filter match expenses and refunds only', () => {
		expect(isFlowFilter('spending')).toBe(true);
		expect(isFlowFilter('refund')).toBe(true);
		expect(isFlowFilter('bogus')).toBe(false);
		expect(flowMatchesFilter('expense', 'spending')).toBe(true);
		expect(flowMatchesFilter('refund', 'spending')).toBe(true);
		expect(flowMatchesFilter('income', 'spending')).toBe(false);
		expect(flowMatchesFilter('transfer', 'spending')).toBe(false);
		expect(flowMatchesFilter('expense', 'refund')).toBe(false);
	});

	it('aggregates budget and investment flows in cents', () => {
		const totals = summarizeFinancialFlows(
			[
				{
					amount: 10000,
					category: { ...investment, financial_treatment: 'income' }
				},
				{
					amount: -6000,
					category: { ...investment, financial_treatment: 'operating' }
				},
				{
					amount: 250,
					category: { ...investment, financial_treatment: 'operating' }
				},
				{
					amount: 800,
					category: { ...investment, financial_treatment: 'investment_income' }
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
			refund: 250,
			contribution: 3000,
			redemption: 1000,
			investmentIncome: 800,
			transfer: 500,
			count: 7
		});
		expect(totals.income - (totals.expense - totals.refund)).toBe(4250);
	});
});
