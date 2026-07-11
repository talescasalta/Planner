import type { PageServerLoad, Actions } from './$types';
import { transactionUpdateSchema } from '$lib/schemas/transaction';
import { canEditTransaction, canReadTransaction, updateTransactionForHousehold, validateTransactionRelations } from '$lib/server/access';
import { getUserHouseholdId, attachPayerProfiles } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { learnFromTransactionAdjustment } from '$lib/server/learning';
import { loadCategoriesForUser } from '$lib/server/categories';
import { fail, redirect } from '@sveltejs/kit';

function normalizeTransactionUpdate(data: ReturnType<typeof transactionUpdateSchema.parse>) {
	return { ...data, subcategory_id: data.category_id ? data.subcategory_id ?? null : null };
}

export const load: PageServerLoad = async ({ params, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) redirect(303, '/app/groups');
	const readable = await canReadTransaction(supabase, params.id, user.id);
	if (!readable) redirect(303, '/app/transactions');

	const { data: txRow, error } = await supabaseAdmin
		.from('transactions')
		.select(`
			*,
			category:categories!transactions_category_id_fkey ( id, name ),
			owner_profile:financial_profiles ( id, name, type )
		`)
		.eq('id', params.id)
		.eq('household_id', householdId)
		.single();

	if (error || !txRow) {
		redirect(303, '/app/transactions');
	}

	const [enrichedTx] = await attachPayerProfiles([txRow]);
	const editable = await canEditTransaction(supabase, params.id, user.id);

	// Load options for editing
	const selectedCategoryIds = [enrichedTx.category_id, enrichedTx.subcategory_id].filter((id): id is string => !!id);
	const [categories, { data: profiles }, { data: memberRows }, { data: household }] = await Promise.all([
		loadCategoriesForUser(supabaseAdmin, householdId, user.id, selectedCategoryIds),
		supabaseAdmin.from('financial_profiles').select('id, household_id, user_id, name, type, created_at').eq('household_id', householdId).order('type', { ascending: false }).order('name'),
		supabaseAdmin.from('household_members').select('user_id').eq('household_id', householdId),
		supabaseAdmin.from('households').select('id, name').eq('id', householdId).single()
	]);

	const memberUserIds = (memberRows ?? []).map((m) => m.user_id);
	const memberProfilesById = new Map<string, { display_name: string | null }>();
	if (memberUserIds.length > 0) {
		const { data: memberProfiles } = await supabaseAdmin
			.from('profiles')
			.select('user_id, display_name')
			.in('user_id', memberUserIds);
		for (const p of memberProfiles ?? []) {
			memberProfilesById.set(p.user_id, { display_name: p.display_name });
		}
	}
	const members = memberUserIds.map((uid) => ({
		user_id: uid,
		display_name: memberProfilesById.get(uid)?.display_name ?? null
	}));

	const assignmentProfiles = (profiles ?? [])
		.filter((p) => p.type === 'shared' || !!p.user_id)
		.map((p) => (p.type === 'shared' ? { ...p, name: household?.name ?? p.name } : p));

	return {
		transaction: enrichedTx,
		editable,
		categories,
		profiles: assignmentProfiles,
		members
	};
};

export const actions: Actions = {
	default: async ({ params, request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const editable = await canEditTransaction(supabase, params.id, user.id);
		if (!editable) return fail(403, { success: false, message: 'Sem permissão para editar' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const formData = Object.fromEntries(await request.formData());
		const parseResult = transactionUpdateSchema.safeParse(formData);
		if (!parseResult.success) {
			return fail(400, { success: false, message: 'Dados inválidos' });
		}
		const normalizedData = normalizeTransactionUpdate(parseResult.data);

		const relationError = await validateTransactionRelations(supabase, householdId, normalizedData, user.id);
		if (relationError) {
			return fail(400, { success: false, message: relationError });
		}

		const patch = {
			...normalizedData,
			review_status: 'confirmed',
			updated_at: new Date().toISOString()
		};

		const { error } = await updateTransactionForHousehold(supabase, params.id, householdId, patch);

		if (error) {
			return fail(500, { success: false, message: error.message });
		}

		await learnFromTransactionAdjustment(supabaseAdmin, {
			householdId,
			userId: user.id,
			transactionId: params.id,
			categoryId: normalizedData.category_id ?? null,
			subcategoryId: normalizedData.category_id ? normalizedData.subcategory_id ?? null : null,
			ownerProfileId: normalizedData.owner_profile_id ?? null
		});

		return { success: true };
	},

	delete: async ({ params, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const editable = await canEditTransaction(supabase, params.id, user.id);
		if (!editable) return fail(403, { success: false, message: 'Sem permissão para apagar' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const { data: tx } = await supabaseAdmin
			.from('transactions')
			.select('reference_month')
			.eq('id', params.id)
			.eq('household_id', householdId)
			.maybeSingle();

		const { error } = await supabaseAdmin
			.from('transactions')
			.delete()
			.eq('id', params.id)
			.eq('household_id', householdId);

		if (error) return fail(500, { success: false, message: error.message });

		const query = tx?.reference_month ? `?month=${encodeURIComponent(tx.reference_month)}` : '';
		redirect(303, `/app/transactions${query}`);
	}
};
