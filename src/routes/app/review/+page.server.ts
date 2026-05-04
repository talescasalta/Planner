import type { PageServerLoad, Actions } from './$types';
import { getUserHouseholdId, attachPayerProfiles } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { validateTransactionRelations } from '$lib/server/access';
import { learnFromTransactionAdjustment } from '$lib/server/learning';
import { filterCategoriesForUser } from '$lib/server/gabarito';
import { loadUserCategoryExclusions } from '$lib/server/categories';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return { transactions: [], categories: [], profiles: [] };

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return { transactions: [], categories: [], profiles: [] };

	const { data: transactions } = await supabaseAdmin
		.from('transactions')
		.select(`
			*,
			category:categories!transactions_category_id_fkey ( id, name ),
			subcategory:categories!transactions_subcategory_id_fkey ( id, name ),
			owner_profile:financial_profiles ( id, name )
		`)
		.eq('household_id', householdId)
		.eq('review_status', 'needs_review')
		.order('date', { ascending: false })
		.limit(200);

	const enriched = await attachPayerProfiles(transactions ?? []);

	const selectedCategoryIds = new Set(
		enriched.flatMap((tx) => [tx.category_id, tx.subcategory_id]).filter((id): id is string => !!id)
	);

	const [{ data: cats }, { data: profs }, { data: household }, excludedCategoryIds] = await Promise.all([
		supabaseAdmin.from('categories').select('id, name, parent_id, created_by_user_id, is_default, created_at, household_id').eq('household_id', householdId).order('name'),
		supabaseAdmin.from('financial_profiles').select('id, household_id, user_id, name, type, created_at').eq('household_id', householdId).order('type', { ascending: false }).order('name'),
		supabaseAdmin.from('households').select('id, name').eq('id', householdId).single(),
		loadUserCategoryExclusions(supabaseAdmin, householdId, user.id)
	]);
	const assignmentProfiles = (profs ?? [])
		.filter((p) => p.type === 'shared' || !!p.user_id)
		.map((p) => (p.type === 'shared' ? { ...p, name: household?.name ?? p.name } : p));

	return {
		transactions: enriched,
		categories: filterCategoriesForUser(cats ?? [], user.id, excludedCategoryIds, selectedCategoryIds),
		profiles: assignmentProfiles
	};
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const transactionId = formData.get('transaction_id') as string;
		const categoryId = formData.get('category_id') as string;
		const subcategoryId = formData.get('subcategory_id') as string;
		const ownerProfileId = formData.get('owner_profile_id') as string;

		if (!transactionId) return fail(400, { success: false, message: 'ID da transação ausente' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Sem grupo' });

		const relationError = await validateTransactionRelations(supabase, householdId, {
			category_id: categoryId || null,
			subcategory_id: categoryId ? subcategoryId || null : null,
			owner_profile_id: ownerProfileId || null
		}, user.id);
		if (relationError) {
			return fail(400, { success: false, message: relationError });
		}

		const { error: updateError } = await supabase
			.from('transactions')
			.update({
				category_id: categoryId || null,
				subcategory_id: categoryId ? subcategoryId || null : null,
				owner_profile_id: ownerProfileId || null,
				review_status: 'confirmed',
				updated_at: new Date().toISOString()
			})
			.eq('id', transactionId);

		if (updateError) {
			return fail(500, { success: false, message: updateError.message });
		}

		await learnFromTransactionAdjustment(supabaseAdmin, {
			householdId,
			userId: user.id,
			transactionId,
			categoryId: categoryId || null,
			subcategoryId: categoryId ? subcategoryId || null : null,
			ownerProfileId: ownerProfileId || null
		});

		return { success: true };
	}
};
