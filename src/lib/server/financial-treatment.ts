import type { FinancialFlowKind, FinancialTreatment } from '$lib/types/app';
export type { FinancialFlowKind } from '$lib/types/app';

export type FinancialCategoryRef = {
	id?: string | null;
	name?: string | null;
	parent_id?: string | null;
	financial_treatment?: FinancialTreatment | null;
};

export type FinancialFlowRow = {
	amount: number | string;
	review_status?: string | null;
	is_transfer?: boolean | null;
	financial_treatment_override?: FinancialTreatment | null;
	category_id?: string | null;
	subcategory_id?: string | null;
	category?: FinancialCategoryRef | FinancialCategoryRef[] | null;
	subcategory?: FinancialCategoryRef | FinancialCategoryRef[] | null;
};

export type FinancialCategory = FinancialCategoryRef & { id: string };

export const FINANCIAL_TREATMENTS: readonly FinancialTreatment[] = [
	'operating',
	'income',
	'investment',
	'investment_income',
	'transfer'
];

export const FINANCIAL_FLOW_KINDS: readonly FinancialFlowKind[] = [
	'income',
	'expense',
	'refund',
	'contribution',
	'redemption',
	'investment_income',
	'transfer',
	'excluded'
];

export function isFinancialTreatment(
	value: unknown
): value is FinancialTreatment {
	return (
		typeof value === 'string' &&
		(FINANCIAL_TREATMENTS as readonly string[]).includes(value)
	);
}

function firstRelation(
	value: FinancialCategoryRef | FinancialCategoryRef[] | null | undefined
) {
	return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function treatmentFromCategory(
	category: FinancialCategoryRef | null,
	categories: ReadonlyMap<string, FinancialCategory>
): FinancialTreatment | null {
	const visited = new Set<string>();
	let current = category;
	while (current) {
		if (isFinancialTreatment(current.financial_treatment)) {
			return current.financial_treatment;
		}
		const parentId = current.parent_id ?? null;
		if (!parentId || visited.has(parentId)) return null;
		visited.add(parentId);
		current = categories.get(parentId) ?? null;
	}
	return null;
}

/**
 * Resolves the persisted financial treatment without using free-form text.
 * The order is deliberately part of the public contract because old rows keep
 * the legacy transfer flag while users can now override one row.
 */
export function resolveFinancialTreatment(
	row: FinancialFlowRow,
	categories: ReadonlyMap<string, FinancialCategory> = new Map()
): FinancialTreatment {
	if (isFinancialTreatment(row.financial_treatment_override)) {
		return row.financial_treatment_override;
	}
	if (row.is_transfer) return 'transfer';

	const subcategoryTreatment = treatmentFromCategory(
		firstRelation(row.subcategory),
		categories
	);
	if (subcategoryTreatment) return subcategoryTreatment;

	const categoryTreatment = treatmentFromCategory(
		firstRelation(row.category),
		categories
	);
	return categoryTreatment ?? 'operating';
}

export function financialFlowKind(
	row: FinancialFlowRow,
	categories: ReadonlyMap<string, FinancialCategory> = new Map()
): FinancialFlowKind {
	if (row.review_status === 'ignored') return 'excluded';
	const treatment = resolveFinancialTreatment(row, categories);
	const amount = Number(row.amount);
	if (treatment === 'transfer') return 'transfer';
	if (treatment === 'investment') {
		return amount < 0 ? 'contribution' : 'redemption';
	}
	// Income keeps its sign so a payroll reversal reduces income instead of
	// showing up as spending.
	if (treatment === 'income') return 'income';
	if (treatment === 'investment_income') {
		return amount < 0 ? 'expense' : 'investment_income';
	}
	// A credit in a consumption category (reimbursement, chargeback, refund) is
	// money coming back, not income: it nets against expenses.
	return amount < 0 ? 'expense' : 'refund';
}

/**
 * `spending` is the filter behind the dashboard's Despesas card: expenses and
 * the refunds netted against them, so the list sums to the card.
 */
export const SPENDING_FLOW_FILTER = 'spending';

export type FlowFilter = FinancialFlowKind | typeof SPENDING_FLOW_FILTER;

export function isFlowFilter(value: unknown): value is FlowFilter {
	return (
		value === SPENDING_FLOW_FILTER ||
		(typeof value === 'string' &&
			(FINANCIAL_FLOW_KINDS as readonly string[]).includes(value))
	);
}

export function flowMatchesFilter(
	kind: FinancialFlowKind,
	filter: FlowFilter
): boolean {
	if (filter === SPENDING_FLOW_FILTER) {
		return kind === 'expense' || kind === 'refund';
	}
	return kind === filter;
}

export function toCents(value: number | string | null | undefined): number {
	const amount = Number(value ?? 0);
	return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function fromCents(value: number): number {
	return value / 100;
}

export type FinancialFlowTotals = {
	/** Earned income, signed (reversals reduce it). */
	income: number;
	/** Gross outflows of consumption categories. */
	expense: number;
	/** Credits in consumption categories; net them against `expense`. */
	refund: number;
	contribution: number;
	redemption: number;
	investmentIncome: number;
	transfer: number;
	count: number;
};

export function summarizeFinancialFlows(
	rows: FinancialFlowRow[],
	categories: ReadonlyMap<string, FinancialCategory> = new Map()
): FinancialFlowTotals {
	const totals = {
		income: 0,
		expense: 0,
		refund: 0,
		contribution: 0,
		redemption: 0,
		investment_income: 0,
		transfer: 0,
		count: 0
	};
	for (const row of rows) {
		const kind = financialFlowKind(row, categories);
		if (kind === 'excluded') continue;
		const cents = toCents(row.amount);
		totals.count += 1;
		if (kind === 'expense' || kind === 'contribution' || kind === 'transfer')
			totals[kind] += Math.abs(cents);
		else totals[kind] += cents;
	}
	return {
		income: fromCents(totals.income),
		expense: fromCents(totals.expense),
		refund: fromCents(totals.refund),
		contribution: fromCents(totals.contribution),
		redemption: fromCents(totals.redemption),
		investmentIncome: fromCents(totals.investment_income),
		transfer: fromCents(totals.transfer),
		count: totals.count
	};
}

export function investmentFlowTotals(
	rows: FinancialFlowRow[],
	categories: ReadonlyMap<string, FinancialCategory> = new Map()
) {
	const totals = summarizeFinancialFlows(rows, categories);
	const net = totals.contribution - totals.redemption;
	return {
		contributions: totals.contribution,
		redemptions: totals.redemption,
		investmentIncome: totals.investmentIncome,
		net,
		// Contributions funded by dividends/interest are reinvestment; only what
		// exceeds them is capital that came from earned income or reserves.
		newCapital: net - totals.investmentIncome
	};
}
