import type { PageServerLoad, Actions } from './$types';
import { transactionSchema } from '$lib/schemas/transaction';
import { getUserHouseholdId, getHouseholdMembers } from '$lib/server/household';
import { validateTransactionRelations } from '$lib/server/access';
import { learnFromTransactionAdjustment } from '$lib/server/learning';
import { loadCategoriesForUser } from '$lib/server/categories';
import { supabaseAdmin } from '$lib/server/supabase';
import { fail, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) {
		return { categories: [], profiles: [], members: [] };
	}

	const [categories, { data: profiles }, { data: members }, { data: household }] = await Promise.all([
		loadCategoriesForUser(supabaseAdmin, householdId, user.id),
		supabase.from('financial_profiles').select('id, household_id, user_id, name, type, created_at').eq('household_id', householdId).order('type', { ascending: false }).order('name'),
		supabase.from('household_members').select('user_id, profiles!inner(display_name)').eq('household_id', householdId),
		supabase.from('households').select('id, name').eq('id', householdId).single()
	]);
	const assignmentProfiles = (profiles ?? [])
		.filter((p) => p.type === 'shared' || !!p.user_id)
		.map((p) => (p.type === 'shared' ? { ...p, name: household?.name ?? p.name } : p));

	return {
		categories,
		profiles: assignmentProfiles,
		members: members ?? []
	};
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = Object.fromEntries(await request.formData());
		const parseResult = transactionSchema.safeParse(formData);
		if (!parseResult.success) {
			const errors = parseResult.error.flatten().fieldErrors;
			return fail(400, { success: false, message: 'Dados inválidos', errors });
		}

		const data = parseResult.data;
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });
		}

		const relationError = await validateTransactionRelations(supabase, householdId, data, user.id);
		if (relationError) {
			return fail(400, { success: false, message: relationError });
		}

		const { data: tx, error: txError } = await supabase
			.from('transactions')
			.insert({
				...data,
				reference_month: data.reference_month ?? data.date.slice(0, 7),
				household_id: householdId,
				created_by_user_id: user.id
			})
			.select()
			.single();

		if (txError || !tx) {
			return fail(500, { success: false, message: txError?.message ?? 'Erro ao criar transação' });
		}

		// Build access rows
		const accessRows: { transaction_id: string; user_id: string; can_read: boolean; can_edit: boolean }[] = [];
		const householdMembers = await getHouseholdMembers(supabase, householdId);

		// Creator always has access
		accessRows.push({ transaction_id: tx.id, user_id: user.id, can_read: true, can_edit: true });

		if (data.owner_profile_id) {
			const { data: profile } = await supabase
				.from('financial_profiles')
				.select('type, user_id')
				.eq('id', data.owner_profile_id)
				.single();

			if (profile) {
				if (profile.type === 'shared') {
					// Shared: all household members get read+edit
					for (const memberId of householdMembers) {
						if (memberId === user.id) continue;
						accessRows.push({ transaction_id: tx.id, user_id: memberId, can_read: true, can_edit: true });
					}
				} else if (profile.type === 'individual' && profile.user_id) {
					// Individual: only the mapped user gets access (and creator already added)
					if (profile.user_id !== user.id) {
						accessRows.push({ transaction_id: tx.id, user_id: profile.user_id, can_read: true, can_edit: true });
					}
				}
			}
		}

		if (data.paid_by_user_id && !accessRows.some((r) => r.user_id === data.paid_by_user_id)) {
			accessRows.push({ transaction_id: tx.id, user_id: data.paid_by_user_id!, can_read: true, can_edit: false });
		}

		const { error: accessError } = await supabase.from('transaction_access').insert(accessRows);
		if (accessError) {
			return fail(500, { success: false, message: accessError.message });
		}

		await learnFromTransactionAdjustment(supabase, {
			householdId,
			userId: user.id,
			transactionId: tx.id,
			categoryId: data.category_id ?? null,
			subcategoryId: data.category_id ? data.subcategory_id ?? null : null,
			ownerProfileId: data.owner_profile_id ?? null
		});

		redirect(303, '/app/transactions');
	}
};
