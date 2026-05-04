import type { PageServerLoad } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { loadCategoriesForUser } from '$lib/server/categories';

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return { totalsByProfile: [], totalsByCategory: [], totalsByPayer: [], filters: {} };

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return { totalsByProfile: [], totalsByCategory: [], totalsByPayer: [], filters: {} };

	const month = url.searchParams.get('month') ?? '';
	const profileId = url.searchParams.get('profile') ?? '';
	const categoryId = url.searchParams.get('category') ?? '';
	const reviewStatus = url.searchParams.get('review_status') ?? '';

	// Load all visible transactions with joins
	let query = supabaseAdmin
		.from('transactions')
		.select(`
			amount,
			date,
			owner_profile_id,
			paid_by_user_id,
			category_id,
			review_status,
			owner_profile:financial_profiles ( id, name ),
			category:categories!transactions_category_id_fkey ( id, name )
		`)
		.eq('household_id', householdId);

	if (month) {
		query = query.gte('date', `${month}-01`).lt('date', getNextMonthFirstDay(month));
	}
	if (profileId) {
		query = query.eq('owner_profile_id', profileId);
	}
	if (categoryId) {
		query = query.eq('category_id', categoryId);
	}
	if (reviewStatus) {
		query = query.eq('review_status', reviewStatus);
	}

	const { data: transactions } = await query;
	const txs = transactions ?? [];

	// Look up payer display names for the txs we got back
	const payerIds = Array.from(new Set(txs.map((t) => t.paid_by_user_id).filter((id): id is string => !!id)));
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

	// Aggregate by profile
	const profileMap = new Map<string, { name: string; total: number }>();
	for (const tx of txs) {
		const key = tx.owner_profile_id ?? 'unknown';
		const existing = profileMap.get(key);
		const name = (tx.owner_profile as { name?: string } | null)?.name ?? 'Desconhecido';
		if (existing) {
			existing.total += tx.amount;
		} else {
			profileMap.set(key, { name, total: tx.amount });
		}
	}

	// Aggregate by category
	const categoryMap = new Map<string, { name: string; total: number }>();
	for (const tx of txs) {
		const key = tx.category_id ?? 'uncategorized';
		const existing = categoryMap.get(key);
		const name = (tx.category as { name?: string } | null)?.name ?? 'Sem categoria';
		if (existing) {
			existing.total += tx.amount;
		} else {
			categoryMap.set(key, { name, total: tx.amount });
		}
	}

	// Aggregate by payer
	const payerMap = new Map<string, { name: string; total: number }>();
	for (const tx of txs) {
		const key = tx.paid_by_user_id ?? 'unknown';
		const existing = payerMap.get(key);
		const name = tx.paid_by_user_id ? payerNameById.get(tx.paid_by_user_id) ?? 'Desconhecido' : 'Desconhecido';
		if (existing) {
			existing.total += tx.amount;
		} else {
			payerMap.set(key, { name, total: tx.amount });
		}
	}

	// Load filter options
	const [{ data: profiles }, categories] = await Promise.all([
		supabaseAdmin.from('financial_profiles').select('id, name').eq('household_id', householdId).order('name'),
		loadCategoriesForUser(supabaseAdmin, householdId, user.id)
	]);

	return {
		totalsByProfile: Array.from(profileMap.values()).sort((a, b) => b.total - a.total),
		totalsByCategory: Array.from(categoryMap.values()).sort((a, b) => b.total - a.total),
		totalsByPayer: Array.from(payerMap.values()).sort((a, b) => b.total - a.total),
		filters: { month, profileId, categoryId, reviewStatus },
		profiles: profiles ?? [],
		categories: categories.filter((c) => !c.parent_id)
	};
};

function getNextMonthFirstDay(yyyyMm: string): string {
	const [y, m] = yyyyMm.split('-').map(Number);
	const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
	return next;
}
