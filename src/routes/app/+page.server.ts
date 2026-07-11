import type { PageServerLoad, Actions } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { z } from 'zod';
import { fail } from '@sveltejs/kit';
import { getReadableTransactionIds } from '$lib/server/access';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { loadCategoriesForUser } from '$lib/server/categories';
import { callLlm } from '$lib/server/llm';

const NO_MONTH = 'Sem mes';
const UNCATEGORIZED_ID = '__uncategorized__';
const UNCATEGORIZED_SUB_ID = '__unspecified__';

type TransactionRow = {
	id: string;
	amount: number;
	currency: string | null;
	date: string;
	description: string;
	clean_description: string | null;
	reference_month: string | null;
	review_status: string;
	category_id: string | null;
	subcategory_id: string | null;
	owner_profile_id: string | null;
	paid_by_user_id: string | null;
	installment_number: number | null;
	installment_total: number | null;
	installment_group_key: string | null;
	category: { id: string | null; name: string | null; parent_id: string | null } | null;
	subcategory: { id: string | null; name: string | null; parent_id: string | null } | null;
	owner_profile: { id: string | null; name: string | null } | null;
};

type CategoryRef = { id: string; name: string };
type CategoryMap = Map<string, { id: string; name: string; parent_id: string | null }>;

function buildCategoryMap(categories: Array<{ id: string; name: string | null; parent_id: string | null }> | null | undefined): CategoryMap {
	return new Map((categories ?? []).map((category) => [category.id, {
		id: category.id,
		name: category.name ?? '',
		parent_id: category.parent_id ?? null
	}]));
}

function resolveCategory(rawCategory: TransactionRow['category'], categoryMap: CategoryMap) {
	if (!rawCategory?.id) return { category: null, derivedSubcategory: null };
	if (!rawCategory.parent_id) {
		return { category: { id: rawCategory.id, name: rawCategory.name ?? 'Sem categoria' }, derivedSubcategory: null };
	}
	const parent = categoryMap.get(rawCategory.parent_id);
	if (!parent) {
		return { category: { id: rawCategory.id, name: rawCategory.name ?? 'Sem categoria' }, derivedSubcategory: null };
	}
	return {
		category: { id: parent.id, name: parent.name ?? 'Sem categoria' },
		derivedSubcategory: { id: rawCategory.id, name: rawCategory.name ?? 'Sem subcategoria' }
	};
}

function resolveTaxonomy(
	tx: TransactionRow,
	categoryMap: CategoryMap
): { category: CategoryRef | null; subcategory: CategoryRef | null } {
	const rawSub = tx.subcategory;
	const { category, derivedSubcategory } = resolveCategory(tx.category, categoryMap);
	let subcategory: CategoryRef | null = derivedSubcategory;
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

type HierarchyChild = { id: string; name: string; total: number };
type HierarchyNode = { id: string; name: string; total: number; children: HierarchyChild[] };

function hierarchyNode(map: Map<string, HierarchyNode>, id: string, name: string) {
	const existing = map.get(id);
	if (existing) return existing;
	const created: HierarchyNode = { id, name, total: 0, children: [] };
	map.set(id, created);
	return created;
}

function hierarchyChild(node: HierarchyNode, id: string, name: string) {
	const existing = node.children.find((child) => child.id === id);
	if (existing) return existing;
	const created = { id, name, total: 0 };
	node.children.push(created);
	return created;
}

function buildHierarchy(rows: TransactionRow[], categoryMap: CategoryMap) {
	const map = new Map<string, HierarchyNode>();
	for (const tx of rows) {
		const amount = Number(tx.amount);
		if (!(amount < 0)) continue;
		const expense = Math.abs(amount);
		const { category, subcategory } = resolveTaxonomy(tx, categoryMap);
		const catId = category?.id ?? UNCATEGORIZED_ID;
		const catName = category?.name ?? 'Sem categoria';
		const node = hierarchyNode(map, catId, catName);
		node.total += expense;
		const subId = subcategory?.id ?? UNCATEGORIZED_SUB_ID;
		const subName = subcategory?.name ?? 'Sem subcategoria';
		const child = hierarchyChild(node, subId, subName);
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

function addMonths(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number);
	if (!y || !m) return month;
	const total = y * 12 + (m - 1) + delta;
	const year = Math.floor(total / 12);
	const mon = (total % 12) + 1;
	return `${year}-${String(mon).padStart(2, '0')}`;
}

// Per-month expense totals keyed by top-level category, over every month that
// has data. Feeds the category trend chart and the above-normal comparison.
function buildCategoryMonthTotals(rows: TransactionRow[], categoryMap: CategoryMap) {
	const byMonth = new Map<string, Map<string, { id: string; name: string; total: number }>>();
	for (const tx of rows) {
		const amount = Number(tx.amount);
		if (!(amount < 0)) continue;
		const month = rowMonth(tx);
		if (month === NO_MONTH) continue;
		const { category } = resolveTaxonomy(tx, categoryMap);
		const id = category?.id ?? UNCATEGORIZED_ID;
		const name = category?.name ?? 'Sem categoria';
		const bucket = byMonth.get(month) ?? new Map();
		const entry = bucket.get(id) ?? { id, name, total: 0 };
		entry.total += Math.abs(amount);
		bucket.set(id, entry);
		byMonth.set(month, bucket);
	}
	return byMonth;
}

const TREND_WINDOW = 12;
const TREND_TOP_CATEGORIES = 5;
const OTHERS_ID = '__others__';

function buildCategoryTrend(byMonth: ReturnType<typeof buildCategoryMonthTotals>) {
	const months = Array.from(byMonth.keys()).sort().slice(-TREND_WINDOW);
	if (months.length === 0) return { months: [], series: [] as { id: string; name: string }[], points: [] };

	const totals = new Map<string, { id: string; name: string; total: number }>();
	for (const month of months) {
		for (const entry of byMonth.get(month)?.values() ?? []) {
			const acc = totals.get(entry.id) ?? { id: entry.id, name: entry.name, total: 0 };
			acc.total += entry.total;
			totals.set(entry.id, acc);
		}
	}
	const ranked = Array.from(totals.values()).sort((a, b) => b.total - a.total);
	const top = ranked.slice(0, TREND_TOP_CATEGORIES);
	const hasOthers = ranked.length > TREND_TOP_CATEGORIES;
	const series = [...top.map((c) => ({ id: c.id, name: c.name })), ...(hasOthers ? [{ id: OTHERS_ID, name: 'Outras' }] : [])];
	const topIds = new Set(top.map((c) => c.id));

	const points = months.map((month) => {
		const bucket = byMonth.get(month);
		const values: Record<string, number> = {};
		let total = 0;
		for (const s of series) values[s.id] = 0;
		for (const entry of bucket?.values() ?? []) {
			const key = topIds.has(entry.id) ? entry.id : OTHERS_ID;
			if (key === OTHERS_ID && !hasOthers) continue;
			values[key] = (values[key] ?? 0) + entry.total;
			total += entry.total;
		}
		return { month, total, values };
	});

	return { months, series, points };
}

const ABOVE_NORMAL_BASELINE_MONTHS = 6;
const ABOVE_NORMAL_MIN_DELTA = 30;

function categoryTotalsForMonths(
	byMonth: ReturnType<typeof buildCategoryMonthTotals>,
	months: string[]
) {
	const totals = new Map<string, number>();
	const names = new Map<string, string>();
	for (const month of months) {
		for (const entry of byMonth.get(month)?.values() ?? []) {
			totals.set(entry.id, (totals.get(entry.id) ?? 0) + entry.total);
			names.set(entry.id, entry.name);
		}
	}
	return { totals, names };
}

function buildAboveNormal(
	byMonth: ReturnType<typeof buildCategoryMonthTotals>,
	selectedMonth: string
) {
	if (!selectedMonth) return [];
	const previousMonths = Array.from(byMonth.keys())
		.filter((m) => m < selectedMonth)
		.sort()
		.slice(-ABOVE_NORMAL_BASELINE_MONTHS);
	if (previousMonths.length < 2) return [];

	const current = categoryTotalsForMonths(byMonth, [selectedMonth]);
	const baseline = categoryTotalsForMonths(byMonth, previousMonths);
	const names = new Map([...baseline.names, ...current.names]);

	const out: Array<{ id: string; name: string; current: number; baseline: number; delta: number; deltaPercent: number | null }> = [];
	for (const id of new Set([...current.totals.keys(), ...baseline.totals.keys()])) {
		const currentTotal = current.totals.get(id) ?? 0;
		const baselineTotal = (baseline.totals.get(id) ?? 0) / previousMonths.length;
		const delta = currentTotal - baselineTotal;
		if (Math.abs(delta) < ABOVE_NORMAL_MIN_DELTA) continue;
		out.push({
			id,
			name: names.get(id) ?? 'Sem categoria',
			current: currentTotal,
			baseline: baselineTotal,
			delta,
			deltaPercent: baselineTotal > 0 ? Math.round((delta / baselineTotal) * 100) : null
		});
	}
	return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 8);
}

function buildSavingsHistory(rows: TransactionRow[]) {
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
	return Array.from(map, ([month, v]) => ({
		month,
		expenses: v.expenses,
		credits: v.credits,
		rate: v.credits > 0 ? (v.credits - v.expenses) / v.credits : null
	}))
		.sort((a, b) => a.month.localeCompare(b.month))
		.slice(-12);
}

function recurrenceKey(tx: TransactionRow): string {
	return (tx.clean_description || tx.description || '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
}

const RECURRENCE_LOOKBACK_MONTHS = 3;
const RECURRENCE_MIN_HITS = 2;

function recurringMonthsByKey(rows: TransactionRow[], lookback: Set<string>) {
	const keyMonths = new Map<string, Set<string>>();
	for (const transaction of rows) {
		if (Number(transaction.amount) >= 0) continue;
		const month = rowMonth(transaction);
		if (!lookback.has(month)) continue;
		const key = recurrenceKey(transaction);
		if (!key) continue;
		const months = keyMonths.get(key) ?? new Set<string>();
		months.add(month);
		keyMonths.set(key, months);
	}
	return keyMonths;
}

// A selected-month expense counts as "fixed" when it is an installment or when
// the same establishment shows up in at least 2 of the 3 previous months.
function buildFixedVsVariable(rows: TransactionRow[], selectedMonth: string) {
	if (!selectedMonth) return { fixedTotal: 0, variableTotal: 0, topFixed: [] as Array<{ name: string; total: number }> };
	const lookback = new Set(
		Array.from({ length: RECURRENCE_LOOKBACK_MONTHS }, (_, i) => addMonths(selectedMonth, -(i + 1)))
	);
	const keyMonths = recurringMonthsByKey(rows, lookback);

	let fixedTotal = 0;
	let variableTotal = 0;
	const fixedByKey = new Map<string, { name: string; total: number }>();
	for (const tx of rows) {
		const amount = Number(tx.amount);
		if (!(amount < 0) || rowMonth(tx) !== selectedMonth) continue;
		const expense = Math.abs(amount);
		const key = recurrenceKey(tx);
		const recurring = (keyMonths.get(key)?.size ?? 0) >= RECURRENCE_MIN_HITS;
		const isInstallment = (tx.installment_total ?? 0) >= 2;
		if (recurring || isInstallment) {
			fixedTotal += expense;
			const entry = fixedByKey.get(key) ?? { name: tx.clean_description || tx.description, total: 0 };
			entry.total += expense;
			fixedByKey.set(key, entry);
		} else {
			variableTotal += expense;
		}
	}
	const topFixed = Array.from(fixedByKey.values())
		.sort((a, b) => b.total - a.total)
		.slice(0, 5);
	return { fixedTotal, variableTotal, topFixed };
}

const FORECAST_MONTHS = 6;

function latestInstallments(rows: TransactionRow[]) {
	const latestByGroup = new Map<string, TransactionRow>();
	for (const transaction of rows) {
		if (!transaction.installment_group_key || !transaction.installment_number || !transaction.installment_total) continue;
		if (Number(transaction.amount) >= 0) continue;
		const current = latestByGroup.get(transaction.installment_group_key);
		if (!current || transaction.installment_number > (current.installment_number ?? 0)) {
			latestByGroup.set(transaction.installment_group_key, transaction);
		}
	}
	return latestByGroup.values();
}

function addInstallmentProjection(
	totals: Map<string, { total: number; count: number }>,
	transaction: TransactionRow,
	baseMonth: string
) {
	const remaining = (transaction.installment_total ?? 0) - (transaction.installment_number ?? 0);
	const startMonth = rowMonth(transaction);
	if (remaining <= 0 || startMonth === NO_MONTH) return 0;
	const amount = Math.abs(Number(transaction.amount));
	let committed = 0;
	for (let index = 1; index <= remaining; index += 1) {
		const month = addMonths(startMonth, index);
		if (baseMonth && month <= baseMonth) continue;
		committed += amount;
		const bucket = totals.get(month) ?? { total: 0, count: 0 };
		bucket.total += amount;
		bucket.count += 1;
		totals.set(month, bucket);
	}
	return committed;
}

// Projects the amounts already committed in installments. For each installment
// group, the latest known row tells how many installments remain; each one
// lands in a subsequent month with (approximately) the same amount.
function buildInstallmentForecast(rows: TransactionRow[], baseMonth: string) {
	const totals = new Map<string, { total: number; count: number }>();
	let totalCommitted = 0;
	for (const transaction of latestInstallments(rows)) {
		totalCommitted += addInstallmentProjection(totals, transaction, baseMonth);
	}
	const months = Array.from(totals, ([month, v]) => ({ month, ...v }))
		.sort((a, b) => a.month.localeCompare(b.month))
		.slice(0, FORECAST_MONTHS);
	return { months, totalCommitted };
}

// Straight-line projection for the running calendar month: how the month is
// likely to close if spending keeps the current daily pace. Only rows DATED
// inside the current calendar month count as "spent so far" — an imported
// statement lands as a lump in the reference month with purchase dates mostly
// from the previous month, and extrapolating that lump would wildly overshoot.
function buildProjection(monthRows: TransactionRow[], selectedMonth: string, savingsHistory: ReturnType<typeof buildSavingsHistory>) {
	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	if (!selectedMonth || selectedMonth !== currentMonth) return null;
	const dayOfMonth = now.getDate();
	const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
	if (dayOfMonth < 3) return null;
	const spent = monthRows
		.filter((row) => row.date?.startsWith(currentMonth))
		.reduce((sum, row) => sum + expenseValue(Number(row.amount)), 0);
	if (spent === 0) return null;
	const projected = (spent / dayOfMonth) * daysInMonth;
	const previous = savingsHistory.filter((h) => h.month < selectedMonth).slice(-3);
	const baseline = previous.length > 0 ? previous.reduce((s, h) => s + h.expenses, 0) / previous.length : null;
	return {
		spent,
		projected,
		baseline,
		percentVsBaseline: baseline && baseline > 0 ? Math.round(((projected - baseline) / baseline) * 100) : null
	};
}

async function fetchVisibleRows(
	supabase: SupabaseClient<Database>,
	userId: string,
	householdId: string
): Promise<TransactionRow[]> {
	const readableTransactionIds = await getReadableTransactionIds(supabase, userId);
	if (readableTransactionIds.length === 0) return [];
	const { data } = await supabaseAdmin
		.from('transactions')
		.select(`
			id,
			amount,
			currency,
			date,
			description,
			clean_description,
			reference_month,
			review_status,
			category_id,
			subcategory_id,
			owner_profile_id,
			paid_by_user_id,
			installment_number,
			installment_total,
			installment_group_key,
			category:categories!transactions_category_id_fkey ( id, name, parent_id ),
			subcategory:categories!transactions_subcategory_id_fkey ( id, name, parent_id ),
			owner_profile:financial_profiles ( id, name )
		`)
		.eq('household_id', householdId)
		.in('id', readableTransactionIds)
		.order('date', { ascending: false });
	return (data ?? []) as unknown as TransactionRow[];
}

function selectDashboardRows(transactions: TransactionRow[], url: URL) {
	const visibleAllMonths = transactions.filter((transaction) => transaction.review_status !== 'ignored');
	const monthOptions = Array.from(
		new Set(visibleAllMonths.map(rowMonth).filter((month) => month !== NO_MONTH))
	).sort((left, right) => right.localeCompare(left));
	const selectedMonth = url.searchParams.get('month') || monthOptions[0] || '';
	const selectedIndex = monthOptions.indexOf(selectedMonth);
	const previousMonth = selectedIndex >= 0 ? monthOptions[selectedIndex + 1] || '' : '';
	const monthRows = selectedMonth
		? visibleAllMonths.filter((transaction) => rowMonth(transaction) === selectedMonth)
		: visibleAllMonths;
	const previousRows = previousMonth
		? visibleAllMonths.filter((transaction) => rowMonth(transaction) === previousMonth)
		: [];
	const profileId = url.searchParams.get('profile') ?? '';
	const categoryId = url.searchParams.get('category') ?? '';
	const reviewStatus = url.searchParams.get('review_status') ?? '';
	const filtered = monthRows.filter((transaction) =>
		(!profileId || transaction.owner_profile_id === profileId) &&
		(!categoryId || transaction.category_id === categoryId) &&
		(!reviewStatus || transaction.review_status === reviewStatus)
	);
	return {
		visibleAllMonths, monthOptions, selectedMonth, previousMonth, monthRows, previousRows, filtered,
		filters: { profileId, categoryId, reviewStatus }
	};
}

async function loadPayerNames(transactions: TransactionRow[]) {
	const payerIds = Array.from(
		new Set(transactions.map((transaction) => transaction.paid_by_user_id).filter((id): id is string => !!id))
	);
	if (payerIds.length === 0) return new Map<string, string>();
	const { data } = await supabaseAdmin.from('profiles').select('user_id, display_name').in('user_id', payerIds);
	return new Map((data ?? []).map((profile) => [profile.user_id, profile.display_name ?? 'Sem nome']));
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
		categoryTrend: { months: [], series: [], points: [] } as ReturnType<typeof buildCategoryTrend>,
		aboveNormal: [] as ReturnType<typeof buildAboveNormal>,
		savingsHistory: [] as ReturnType<typeof buildSavingsHistory>,
		fixedVsVariable: { fixedTotal: 0, variableTotal: 0, topFixed: [] } as ReturnType<typeof buildFixedVsVariable>,
		installmentForecast: { months: [], totalCommitted: 0 } as ReturnType<typeof buildInstallmentForecast>,
		projection: null as ReturnType<typeof buildProjection>,
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

	const transactions = await fetchVisibleRows(supabase, user.id, householdId);
	if (transactions.length === 0) return empty;
	const {
		visibleAllMonths, monthOptions, selectedMonth, previousMonth, monthRows, previousRows, filtered, filters
	} = selectDashboardRows(transactions, url);
	const payerNameById = await loadPayerNames(filtered);

	const [{ data: profilesData }, categoriesData] = await Promise.all([
		supabaseAdmin.from('financial_profiles').select('id, name').eq('household_id', householdId).order('name'),
		loadCategoriesForUser(supabaseAdmin, householdId, user.id)
	]);

	const categoryMap = buildCategoryMap(categoriesData);

	const hierarchy = buildHierarchy(filtered, categoryMap);
	// Health/time analyses intentionally ignore the secondary filters: they
	// describe the household month as a whole, like the monthly trend does.
	const categoryMonthTotals = buildCategoryMonthTotals(visibleAllMonths, categoryMap);
	const savingsHistory = buildSavingsHistory(visibleAllMonths);
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
		categoryTrend: buildCategoryTrend(categoryMonthTotals),
		aboveNormal: buildAboveNormal(categoryMonthTotals, selectedMonth),
		savingsHistory,
		fixedVsVariable: buildFixedVsVariable(visibleAllMonths, selectedMonth),
		installmentForecast: buildInstallmentForecast(visibleAllMonths, selectedMonth),
		projection: buildProjection(monthRows, selectedMonth, savingsHistory),
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
		filters
	};
};

const insightsResponseSchema = z.object({
	insights: z.array(z.string().min(1)).min(1).max(6)
});

const NEW_MERCHANT_MIN_TOTAL = 40;

function findNewMerchants(visible: TransactionRow[], monthRows: TransactionRow[], month: string) {
	const lookback = new Set(Array.from({ length: 3 }, (_, index) => addMonths(month, -(index + 1))));
	const previousKeys = new Set(
		visible.filter((transaction) => lookback.has(rowMonth(transaction)) && Number(transaction.amount) < 0).map(recurrenceKey)
	);
	const totals = new Map<string, number>();
	for (const transaction of monthRows) {
		if (Number(transaction.amount) >= 0) continue;
		const key = recurrenceKey(transaction);
		if (!key || previousKeys.has(key)) continue;
		totals.set(key, (totals.get(key) ?? 0) + Math.abs(Number(transaction.amount)));
	}
	return Array.from(totals, ([name, total]) => ({ name, total }))
		.filter((merchant) => merchant.total >= NEW_MERCHANT_MIN_TOTAL)
		.sort((left, right) => right.total - left.total)
		.slice(0, 5);
}

export const actions: Actions = {
	insights: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const month = String(formData.get('month') ?? '').trim();
		if (!/^\d{4}-\d{2}$/.test(month)) {
			return fail(400, { success: false, message: 'Mês inválido' });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const transactions = await fetchVisibleRows(supabase, user.id, householdId);
		const visible = transactions.filter((t) => t.review_status !== 'ignored');
		const monthRows = visible.filter((t) => rowMonth(t) === month);
		if (monthRows.length === 0) {
			return fail(400, { success: false, message: 'Sem transações neste mês para analisar.' });
		}

		const categoriesData = await loadCategoriesForUser(supabaseAdmin, householdId, user.id);
		const categoryMap = buildCategoryMap(categoriesData);

		const categoryMonthTotals = buildCategoryMonthTotals(visible, categoryMap);
		const savingsHistory = buildSavingsHistory(visible);
		const aboveNormal = buildAboveNormal(categoryMonthTotals, month);
		const fixedVsVariable = buildFixedVsVariable(visible, month);
		const forecast = buildInstallmentForecast(visible, month);
		const summary = summarize(monthRows);

		const newMerchants = findNewMerchants(visible, monthRows, month);

		const facts = {
			mes: month,
			despesas_total: Math.round(summary.expenses),
			receitas_total: Math.round(summary.credits),
			taxa_poupanca_pct: summary.credits > 0 ? Math.round(((summary.credits - summary.expenses) / summary.credits) * 100) : null,
			historico_despesas: savingsHistory.slice(-6).map((h) => ({ mes: h.month, despesas: Math.round(h.expenses) })),
			categorias_fora_do_normal: aboveNormal.map((a) => ({
				categoria: a.name,
				atual: Math.round(a.current),
				media_anterior: Math.round(a.baseline),
				variacao_pct: a.deltaPercent
			})),
			gastos_fixos: Math.round(fixedVsVariable.fixedTotal),
			gastos_variaveis: Math.round(fixedVsVariable.variableTotal),
			parcelas_comprometidas_proximos_meses: Math.round(forecast.totalCommitted),
			estabelecimentos_novos: newMerchants.map((m) => ({ nome: m.name, total: Math.round(m.total) }))
		};

		const systemPrompt = `Você é um analista de finanças pessoais de uma família brasileira. Receberá agregados de um mês e deve responder APENAS com JSON no formato {"insights": ["...", "..."]}.

Regras:
- 3 a 5 insights curtos (1 frase cada), em português do Brasil, tom direto e concreto.
- Priorize o que é acionável: categorias fora do normal, assinaturas/estabelecimentos novos, ritmo vs meses anteriores, peso dos fixos e das parcelas.
- Cite valores em R$ arredondados e percentuais quando relevantes.
- Não invente dados que não estão nos agregados; não dê conselhos genéricos ("gaste menos").`;

		try {
			const response = await callLlm({
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: JSON.stringify(facts) }
				],
				temperature: 0.3,
				max_tokens: 700,
				json_mode: true
			});
			const raw = response.choices[0]?.message?.content ?? '{}';
			const parsed = JSON.parse(raw.replace(/```json\s*|\s*```/g, '').trim());
			const validated = insightsResponseSchema.safeParse(parsed);
			if (!validated.success) {
				return fail(500, { success: false, message: 'A IA não retornou insights válidos. Tente novamente.' });
			}
			return { success: true, insights: validated.data.insights, insightsMonth: month };
		} catch (error) {
			console.error('[dashboard] insights failed', error);
			return fail(500, { success: false, message: 'Não foi possível gerar os insights agora. Verifique a configuração da IA.' });
		}
	}
};
