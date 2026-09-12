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
	'investment',
	'transfer'
];

export const FINANCIAL_FLOW_KINDS: readonly FinancialFlowKind[] = [
	'income',
	'expense',
	'contribution',
	'redemption',
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
	return amount < 0 ? 'expense' : 'income';
}

export function toCents(value: number | string | null | undefined): number {
	const amount = Number(value ?? 0);
	return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function fromCents(value: number): number {
	return value / 100;
}

export type FinancialFlowTotals = {
	income: number;
	expense: number;
	contribution: number;
	redemption: number;
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
		contribution: 0,
		redemption: 0,
		transfer: 0,
		count: 0
	};
	for (const row of rows) {
		const kind = financialFlowKind(row, categories);
		if (kind === 'excluded') continue;
		const cents = toCents(row.amount);
		totals.count += 1;
		if (kind === 'income' || kind === 'redemption') totals[kind] += cents;
		else if (kind === 'expense' || kind === 'contribution')
			totals[kind] += Math.abs(cents);
		else totals.transfer += Math.abs(cents);
	}
	return {
		income: fromCents(totals.income),
		expense: fromCents(totals.expense),
		contribution: fromCents(totals.contribution),
		redemption: fromCents(totals.redemption),
		transfer: fromCents(totals.transfer),
		count: totals.count
	};
}

export function investmentFlowTotals(
	rows: FinancialFlowRow[],
	categories: ReadonlyMap<string, FinancialCategory> = new Map()
) {
	const totals = summarizeFinancialFlows(rows, categories);
	return {
		contributions: totals.contribution,
		redemptions: totals.redemption,
		net: totals.contribution - totals.redemption
	};
}
