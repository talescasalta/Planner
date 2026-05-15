import type { PageServerLoad } from './$types';
import { getReadableTransactionIds } from '$lib/server/access';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { loadCategoriesForUser } from '$lib/server/categories';

const NO_MONTH = 'Sem mes';
const UNCATEGORIZED_ID = '__uncategorized__';
const UNCATEGORIZED_SUB_ID = '__unspecified__';

type TransactionRow = {
	id: string;
	amount: number;
	currency: string | null;
	date: string;
	description: string;
	reference_month: string | null;
	review_status: string;
	category_id: string | null;
	subcategory_id: string | null;
	owner_profile_id: string | null;
	paid_by_user_id: string | null;
	category: { id: string | null; name: string | null; parent_id: string | null } | null;
	subcategory: { id: string | null; name: string | null; parent_id: string | null } | null;
	owner_profile: { id: string | null; name: string | null } | null;
};

type CategoryRef = { id: string; name: string };
type CategoryMap = Map<string, { id: string; name: string; parent_id: string | null }>;

function resolveTaxonomy(
	tx: TransactionRow,
	categoryMap: CategoryMap
): { category: CategoryRef | null; subcategory: CategoryRef | null } {
	const rawCat = tx.category;
	const rawSub = tx.subcategory;

	// Resolve the transaction's `category` to its top-level ancestor. If the
	// transaction accidentally has a subcategory in the `category_id` slot,
	// hoist it up so the hierarchy renders under the correct parent.
	let category: CategoryRef | null = null;
	let derivedSub: CategoryRef | null = null;
	if (rawCat && rawCat.id) {
		if (rawCat.parent_id) {
			const parent = categoryMap.get(rawCat.parent_id);
			if (parent) {
				category = { id: parent.id, name: parent.name ?? 'Sem categoria' };
				derivedSub = { id: rawCat.id, name: rawCat.name ?? 'Sem subcategoria' };
			} else {
				category = { id: rawCat.id, name: rawCat.name ?? 'Sem categoria' };
			}
		} else {
			category = { id: rawCat.id, name: rawCat.name ?? 'Sem categoria' };
		}
	}

	let subcategory: CategoryRef | null = derivedSub;
	if (rawSub && rawSub.id && rawSub.id !== category?.id) {
		subcategory = { id: rawSub.id, name: rawSub.name ?? 'Sem subcategoria' };
	}

	return { category, subcategory };
}

function monthFromDate(date: string | null | undefined) {
	return date?.slice(0, 7) || NO_MONTH;
}

function rowMonth(row: Pick<TransactionRow, 'reference_month' | 'date'>) {
	return row.reference_month || monthFromDate(row.date);
}

function expenseValue(amount: number) {
	return amount < 0 ? Math.abs(amount) : 0;
}

function creditValue(amount: number) {
	return amount > 0 ? amount : 0;
}

function summarize(rows: TransactionRow[]) {
	const expenses = rows.reduce((sum, row) => sum + expenseValue(Number(row.amount)), 0);
	const credits = rows.reduce((sum, row) => sum + creditValue(Number(row.amount)), 0);
	const balance = rows.reduce((sum, row) => sum + Number(row.amount), 0);
	const needsReview = rows.filter((row) => row.review_status === 'needs_review').length;
	const uncategorized = rows.filter((row) => !row.category_id && Number(row.amount) < 0).length;
	return { count: rows.length, expenses, credits, balance, needsReview, uncategorized };
}

function buildHierarchy(rows: TransactionRow[], categoryMap: CategoryMap) {
	type Child = { id: string; name: string; total: number };
	type Node = { id: string; name: string; total: number; children: Child[] };
	const map = new Map<string, Node>();
	for (const tx of rows) {
		const amount = Number(tx.amount);
		if (!(amount < 0)) continue;
		const expense = Math.abs(amount);
		const { category, subcategory } = resolveTaxonomy(tx, categoryMap);
		const catId = category?.id ?? UNCATEGORIZED_ID;
		const catName = category?.name ?? 'Sem categoria';
		let node = map.get(catId);
		if (!node) {
			node = { id: catId, name: catName, total: 0, children: [] };
			map.set(catId, node);
		}
		node.total += expense;
		const subId = subcategory?.id ?? UNCATEGORIZED_SUB_ID;
		const subName = subcategory?.name ?? 'Sem subcategoria';
		let child = node.children.find((c) => c.id === subId);
		if (!child) {
			child = { id: subId, name: subName, total: 0 };
			node.children.push(child);
		}
		child.total += expense;
	}
	return Array.from(map.values())
		.map((n) => ({ ...n, children: n.children.sort((a, b) => b.total - a.total) }))
		.sort((a, b) => b.total - a.total);
}

function aggregateBy(rows: TransactionRow[], keyFor: (row: TransactionRow) => { id: string; name: string }) {
	const map = new Map<string, { id: string; name: string; total: number }>();
	for (const row of rows) {
		const expense = expenseValue(Number(row.amount));
		if (expense === 0) continue;
		const { id, name } = keyFor(row);
		const existing = map.get(id);
		if (existing) existing.total += expense;
		else map.set(id, { id, name, total: expense });
	}
	const total = Array.from(map.values()).reduce((s, n) => s + n.total, 0);
	return Array.from(map.values())
		.sort((a, b) => b.total - a.total)
		.map((n) => ({ ...n, share: total > 0 ? Math.round((n.total / total) * 100) : 0 }));
}

function buildMonthlyTrend(rows: TransactionRow[]) {
	const map = new Map<string, { expenses: number; credits: number }>();
	for (const row of rows) {
		const month = rowMonth(row);
		if (month === NO_MONTH) continue;
		const bucket = map.get(month) ?? { expenses: 0, credits: 0 };
		const amount = Number(row.amount);
		bucket.expenses += expenseValue(amount);
		bucket.credits += creditValue(amount);
		map.set(month, bucket);
	}
	return Array.from(map, ([month, value]) => ({ month, ...value, balance: value.credits - value.expenses }))
		.sort((a, b) => a.month.localeCompare(b.month))
		.slice(-6);
}

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const empty = {
		monthOptions: [] as string[],
		selectedMonth: '',
		previousMonth: '',
		summary: summarize([]),
		previousSummary: summarize([]),
		monthlyTrend: [] as ReturnType<typeof buildMonthlyTrend>,
		expenseHierarchy: [] as ReturnType<typeof buildHierarchy>,
		totalExpenses: 0,
		byProfile: [] as ReturnType<typeof aggregateBy>,
		byPayer: [] as ReturnType<typeof aggregateBy>,
		filteredTransactions: [] as {
			id: string;
			date: string;
			description: string;
			amount: number;
			currency: string | null;
			category_id: string | null;
			subcategory_id: string | null;
		}[],
		recentTransactions: [] as TransactionRow[],
		profiles: [] as { id: string; name: string }[],
		categories: [] as { id: string; name: string }[],
		filters: { profileId: '', categoryId: '', reviewStatus: '' }
	};

	const { user } = await safeGetSession();
	if (!user) return empty;

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return empty;

	const readableTransactionIds = await getReadableTransactionIds(supabase, user.id);
	if (readableTransactionIds.length === 0) return empty;

	const profileId = url.searchParams.get('profile') ?? '';
	const categoryId = url.searchParams.get('category') ?? '';
	const reviewStatus = url.searchParams.get('review_status') ?? '';

	const { data } = await supabaseAdmin
		.from('transactions')
		.select(`
			id,
			amount,
			currency,
			date,
			description,
			reference_month,
			review_status,
			category_id,
			subcategory_id,
			owner_profile_id,
			paid_by_user_id,
			category:categories!transactions_category_id_fkey ( id, name, parent_id ),
			subcategory:categories!transactions_subcategory_id_fkey ( id, name, parent_id ),
			owner_profile:financial_profiles ( id, name )
		`)
		.eq('household_id', householdId)
		.in('id', readableTransactionIds)
		.order('date', { ascending: false });

	const transactions = (data ?? []) as unknown as TransactionRow[];
	const visibleAllMonths = transactions.filter((t) => t.review_status !== 'ignored');
	const monthOptions = Array.from(
		new Set(visibleAllMonths.map(rowMonth).filter((m) => m !== NO_MONTH))
	).sort((a, b) => b.localeCompare(a));
	const selectedMonth = url.searchParams.get('month') || monthOptions[0] || '';
	const selectedIndex = monthOptions.indexOf(selectedMonth);
	const previousMonth = selectedIndex >= 0 ? monthOptions[selectedIndex + 1] || '' : '';

	const monthRows = selectedMonth ? visibleAllMonths.filter((t) => rowMonth(t) === selectedMonth) : visibleAllMonths;
	const previousRows = previousMonth ? visibleAllMonths.filter((t) => rowMonth(t) === previousMonth) : [];

	// Apply secondary filters (profile, category, review_status).
	let filtered = monthRows;
	if (profileId) filtered = filtered.filter((t) => t.owner_profile_id === profileId);
	if (categoryId) filtered = filtered.filter((t) => t.category_id === categoryId);
	if (reviewStatus) filtered = filtered.filter((t) => t.review_status === reviewStatus);

	// Look up payer display names for whatever passed the filters.
	const payerIds = Array.from(new Set(filtered.map((t) => t.paid_by_user_id).filter((id): id is string => !!id)));
	const payerNameById = new Map<string, string>();
	if (payerIds.length > 0) {
		const { data: payerProfiles } = await supabaseAdmin
			.from('profiles')
			.select('user_id, display_name')
			.in('user_id', payerIds);
		for (const p of payerProfiles ?? []) {
			payerNameById.set(p.user_id, p.display_name ?? 'Sem nome');
		}
	}

	const [{ data: profilesData }, categoriesData] = await Promise.all([
		supabaseAdmin.from('financial_profiles').select('id, name').eq('household_id', householdId).order('name'),
		loadCategoriesForUser(supabaseAdmin, householdId, user.id)
	]);

	const categoryMap: CategoryMap = new Map();
	for (const c of categoriesData ?? []) {
		if (c.id) categoryMap.set(c.id, { id: c.id, name: c.name ?? '', parent_id: c.parent_id ?? null });
	}

	const hierarchy = buildHierarchy(filtered, categoryMap);
	const resolvedFiltered = filtered.map((t) => {
		const { category, subcategory } = resolveTaxonomy(t, categoryMap);
		return {
			id: t.id,
			date: t.date,
			description: t.description,
			amount: Number(t.amount),
			currency: t.currency,
			category_id: category?.id ?? null,
			subcategory_id: subcategory?.id ?? null
		};
	});

	return {
		monthOptions,
		selectedMonth,
		previousMonth,
		summary: summarize(filtered),
		previousSummary: summarize(previousRows),
		monthlyTrend: buildMonthlyTrend(visibleAllMonths),
		expenseHierarchy: hierarchy,
		totalExpenses: hierarchy.reduce((s, n) => s + n.total, 0),
		byProfile: aggregateBy(filtered, (t) => ({
			id: t.owner_profile?.id ?? 'unknown',
			name: t.owner_profile?.name ?? 'Sem atribuição'
		})),
		byPayer: aggregateBy(filtered, (t) => ({
			id: t.paid_by_user_id ?? 'unknown',
			name: t.paid_by_user_id ? payerNameById.get(t.paid_by_user_id) ?? 'Sem nome' : 'Sem pagador'
		})),
		filteredTransactions: resolvedFiltered,
		recentTransactions: filtered.slice(0, 8),
		profiles: profilesData ?? [],
		categories: (categoriesData ?? []).filter((c) => !c.parent_id),
		filters: { profileId, categoryId, reviewStatus }
	};
};
