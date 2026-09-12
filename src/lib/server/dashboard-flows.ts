interface Category {
	id?: string | null;
	name: string | null;
	parent_id?: string | null;
}

interface CashFlow {
	amount: number;
	review_status: string;
	is_transfer: boolean;
	category: Category | null;
	subcategory: Category | null;
}

export type FlowKind =
	'income' | 'expense' | 'contribution' | 'redemption' | 'excluded';

function normalized(name: string | null | undefined) {
	return (name ?? '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.trim()
		.toLowerCase();
}

function hasInvestmentCategory(
	category: Category | null,
	categories: ReadonlyMap<string, Category>
) {
	const visited = new Set<string>();
	let investment = false;
	while (category) {
		investment ||=
			/^(investimentos?|aplicacoes financeiras|aplicacao financeira|aportes?|resgates?)$/.test(
				normalized(category.name)
			);
		if (!category.parent_id || visited.has(category.parent_id)) break;
		visited.add(category.parent_id);
		category = categories.get(category.parent_id) ?? null;
	}
	return investment;
}

// Classification follows the user-selected taxonomy, never merchant text.
// A more specific income/cost subcategory takes precedence over Investments.
export function dashboardFlowKind(
	row: CashFlow,
	categories: ReadonlyMap<string, Category> = new Map()
): FlowKind {
	if (row.review_status === 'ignored') return 'excluded';
	const leaf = row.subcategory ?? row.category;
	const operating =
		/^(rendimentos?|dividendos?|juros|jcp|impostos?|ir|iof|taxas?|tarifas?|corretagem|custodia)\b/.test(
			normalized(leaf?.name)
		);
	const investment =
		hasInvestmentCategory(leaf, categories) ||
		hasInvestmentCategory(row.category, categories);
	// An explicitly categorized investment can also be marked as a transfer.
	if (investment && !operating)
		return row.amount < 0 ? 'contribution' : 'redemption';
	if (row.is_transfer) return 'excluded';
	return row.amount < 0 ? 'expense' : 'income';
}

export function investmentFlowTotals(
	rows: CashFlow[],
	categories: ReadonlyMap<string, Category>
) {
	let contributions = 0;
	let redemptions = 0;
	for (const row of rows) {
		const kind = dashboardFlowKind(row, categories);
		if (kind === 'contribution') contributions += Math.abs(Number(row.amount));
		if (kind === 'redemption') redemptions += Number(row.amount);
	}
	return { contributions, redemptions, net: contributions - redemptions };
}
