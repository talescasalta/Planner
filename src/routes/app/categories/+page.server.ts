import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { loadCategorySettingsForUser, loadCategoriesForUser } from '$lib/server/categories';

function cleanName(value: FormDataEntryValue | null): string {
	return String(value ?? '').trim().replace(/\s+/g, ' ');
}

async function categoryUsageCount(categoryId: string) {
	const results = await Promise.all([
		supabaseAdmin.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', categoryId),
		supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).eq('category_id', categoryId),
		supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).eq('subcategory_id', categoryId),
		supabaseAdmin.from('classification_rules').select('id', { count: 'exact', head: true }).eq('category_id', categoryId),
		supabaseAdmin.from('classification_rules').select('id', { count: 'exact', head: true }).eq('subcategory_id', categoryId)
	]);
	return results.reduce((total, result) => total + (result.count ?? 0), 0);
}

async function hideCategoryForUser(householdId: string, userId: string, categoryId: string) {
	return supabaseAdmin.from('user_category_exclusions').upsert(
		{ household_id: householdId, user_id: userId, category_id: categoryId },
		{ onConflict: 'household_id,user_id,category_id' }
	);
}

async function loadVisibleCategories(householdId: string, userId: string) {
	return loadCategoriesForUser(supabaseAdmin, householdId, userId);
}

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return { categories: [], hiddenCategories: [] };

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return { categories: [], hiddenCategories: [] };

	return loadCategorySettingsForUser(supabaseAdmin, householdId, user.id);
};

export const actions: Actions = {
	create_category: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const formData = await request.formData();
		const name = cleanName(formData.get('name'));
		if (!name) return fail(400, { success: false, message: 'Informe o nome da categoria' });

		const visibleCategories = await loadVisibleCategories(householdId, user.id);
		if (visibleCategories.some((category) => !category.parent_id && category.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
			return fail(409, { success: false, message: 'Essa categoria já existe no seu gabarito' });
		}

		const { error } = await supabaseAdmin.from('categories').insert({
			household_id: householdId,
			name,
			parent_id: null,
			created_by_user_id: user.id,
			is_default: false
		});

		if (error) return fail(500, { success: false, message: error.message });
		return { success: true, message: 'Categoria criada' };
	},

	create_subcategory: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const formData = await request.formData();
		const parentId = cleanName(formData.get('parent_id'));
		const name = cleanName(formData.get('name'));
		if (!parentId || !name) return fail(400, { success: false, message: 'Informe categoria e subcategoria' });

		const visibleCategories = await loadVisibleCategories(householdId, user.id);
		const parent = visibleCategories.find((category) => category.id === parentId && !category.parent_id);
		if (!parent) return fail(400, { success: false, message: 'Categoria pai inválida' });

		if (visibleCategories.some((category) => category.parent_id === parentId && category.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
			return fail(409, { success: false, message: 'Essa subcategoria já existe nessa categoria' });
		}

		const { error } = await supabaseAdmin.from('categories').insert({
			household_id: householdId,
			name,
			parent_id: parentId,
			created_by_user_id: user.id,
			is_default: false
		});

		if (error) return fail(500, { success: false, message: error.message });
		return { success: true, message: 'Subcategoria criada' };
	},

	delete: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const formData = await request.formData();
		const categoryId = cleanName(formData.get('category_id'));
		if (!categoryId) return fail(400, { success: false, message: 'Categoria ausente' });

		const { data: category } = await supabaseAdmin
			.from('categories')
			.select('id, parent_id, created_by_user_id')
			.eq('id', categoryId)
			.eq('household_id', householdId)
			.maybeSingle();

		if (!category) {
			return fail(404, { success: false, message: 'Categoria não encontrada' });
		}

		if (category.created_by_user_id !== user.id) {
			const { error } = await hideCategoryForUser(householdId, user.id, categoryId);
			if (error) return fail(500, { success: false, message: error.message });
			return { success: true, message: 'Sugestão removida do seu gabarito' };
		}

		const usageCount = await categoryUsageCount(categoryId);
		if (usageCount > 0) {
			return fail(409, {
				success: false,
				message: 'Essa categoria está em uso. Reclassifique as transações/regras ou remova as subcategorias antes de deletar.'
			});
		}

		const { error } = await supabaseAdmin.from('categories').delete().eq('id', categoryId).eq('created_by_user_id', user.id);
		if (error) return fail(500, { success: false, message: error.message });
		return { success: true, message: 'Item removido do gabarito pessoal' };
	},

	restore: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const formData = await request.formData();
		const categoryId = cleanName(formData.get('category_id'));
		if (!categoryId) return fail(400, { success: false, message: 'Categoria ausente' });

		const { error } = await supabaseAdmin
			.from('user_category_exclusions')
			.delete()
			.eq('household_id', householdId)
			.eq('user_id', user.id)
			.eq('category_id', categoryId);

		if (error) return fail(500, { success: false, message: error.message });
		return { success: true, message: 'Sugestão restaurada no seu gabarito' };
	}
};
