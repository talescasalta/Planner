import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { filterCategoriesForUser } from '$lib/server/gabarito';

export type CategoryRow = {
	id: string;
	household_id: string;
	name: string;
	parent_id: string | null;
	created_by_user_id: string | null;
	is_default: boolean;
	created_at: string;
};

export async function loadUserCategoryExclusions(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId: string
): Promise<Set<string>> {
	const { data } = await supabase
		.from('user_category_exclusions')
		.select('category_id')
		.eq('household_id', householdId)
		.eq('user_id', userId);

	return new Set((data ?? []).map((row) => row.category_id));
}

export async function loadCategoriesForUser(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId: string,
	includeCategoryIds: Iterable<string> = []
): Promise<CategoryRow[]> {
	const [{ data: categories }, excludedIds] = await Promise.all([
		supabase
			.from('categories')
			.select(
				'id, household_id, name, parent_id, created_by_user_id, is_default, created_at'
			)
			.eq('household_id', householdId)
			.order('name'),
		loadUserCategoryExclusions(supabase, householdId, userId)
	]);

	return filterCategoriesForUser(
		categories ?? [],
		userId,
		excludedIds,
		includeCategoryIds
	);
}

export async function loadCategorySettingsForUser(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId: string
): Promise<{ categories: CategoryRow[]; hiddenCategories: CategoryRow[] }> {
	const [{ data: categories }, excludedIds] = await Promise.all([
		supabase
			.from('categories')
			.select(
				'id, household_id, name, parent_id, created_by_user_id, is_default, created_at'
			)
			.eq('household_id', householdId)
			.order('name'),
		loadUserCategoryExclusions(supabase, householdId, userId)
	]);

	const allSuggestable = filterCategoriesForUser(categories ?? [], userId);
	const hiddenCategories = allSuggestable.filter((category) =>
		excludedIds.has(category.id)
	);
	const visibleCategories = filterCategoriesForUser(
		categories ?? [],
		userId,
		excludedIds
	);

	return { categories: visibleCategories, hiddenCategories };
}
