import type { PageServerLoad, Actions } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import { validateTransactionRelations } from '$lib/server/access';
import { loadCategoriesForUser } from '$lib/server/categories';
import { deleteRuleForHousehold, updateRuleActiveForHousehold } from '$lib/server/rules';
import { fail } from '@sveltejs/kit';

function readRuleForm(formData: FormData) {
	const categoryId = String(formData.get('category_id') ?? '') || null;
	return {
		pattern: String(formData.get('pattern') ?? ''),
		patternType: String(formData.get('pattern_type') ?? ''),
		categoryId,
		subcategoryId: categoryId ? String(formData.get('subcategory_id') ?? '') || null : null,
		ownerProfileId: String(formData.get('owner_profile_id') ?? '') || null,
		confidence: Number.parseFloat(String(formData.get('confidence') ?? '0.95'))
	};
}

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return { rules: [], categories: [], profiles: [] };

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return { rules: [], categories: [], profiles: [] };

	const [{ data: rules }, categories, { data: profiles }] = await Promise.all([
		supabase
			.from('classification_rules')
			.select(`
				*,
				category:categories ( id, name ),
				subcategory:categories!classification_rules_subcategory_id_fkey ( id, name ),
				owner_profile:financial_profiles ( id, name )
			`)
			.eq('household_id', householdId)
			.order('created_at', { ascending: false }),
		loadCategoriesForUser(supabase, householdId, user.id),
		supabase.from('financial_profiles').select('id, name').eq('household_id', householdId).order('name')
	]);

	return {
		rules: rules ?? [],
		categories,
		profiles: profiles ?? []
	};
};

export const actions: Actions = {
	create: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const { pattern, patternType, categoryId, subcategoryId, ownerProfileId, confidence } = readRuleForm(formData);

		if (!pattern || !patternType || !categoryId) {
			return fail(400, { success: false, message: 'Informe padrão, tipo e categoria' });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Sem grupo' });

		const relationError = await validateTransactionRelations(supabase, householdId, {
			category_id: categoryId,
			subcategory_id: subcategoryId,
			owner_profile_id: ownerProfileId
		}, user.id);
		if (relationError) {
			return fail(400, { success: false, message: relationError });
		}

		const { error } = await supabase.from('classification_rules').insert({
			household_id: householdId,
			pattern,
			pattern_type: patternType,
			category_id: categoryId,
			subcategory_id: subcategoryId,
			owner_profile_id: ownerProfileId,
			confidence,
			created_by_user_id: user.id,
			active: true
		});

		if (error) return fail(500, { success: false, message: error.message });
		return { success: true };
	},

	toggle: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const ruleId = formData.get('rule_id') as string;
		const active = formData.get('active') === 'true';

		if (!ruleId) return fail(400, { success: false, message: 'ID ausente' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Sem grupo' });

		const { error } = await updateRuleActiveForHousehold(supabase, householdId, ruleId, active);
		if (error) return fail(500, { success: false, message: error.message });
		return { success: true };
	},

	delete: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const ruleId = formData.get('rule_id') as string;

		if (!ruleId) return fail(400, { success: false, message: 'ID ausente' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Sem grupo' });

		const { error } = await deleteRuleForHousehold(supabase, householdId, ruleId);
		if (error) return fail(500, { success: false, message: error.message });
		return { success: true };
	}
};
