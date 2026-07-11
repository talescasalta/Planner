import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

export async function isHouseholdAdmin(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId: string
): Promise<boolean> {
	const { data, error } = await supabase
		.from('household_members')
		.select('user_id')
		.eq('household_id', householdId)
		.eq('user_id', userId)
		.eq('role', 'admin')
		.maybeSingle();
	return !error && !!data;
}

export async function canReadTransaction(
	supabase: SupabaseClient<Database>,
	transactionId: string,
	userId: string
): Promise<boolean> {
	const { data, error } = await supabase
		.from('transaction_access')
		.select('id')
		.eq('transaction_id', transactionId)
		.eq('user_id', userId)
		.eq('can_read', true)
		.maybeSingle();
	return !error && !!data;
}

export async function getReadableTransactionIds(
	supabase: SupabaseClient<Database>,
	userId: string,
	options: { canEdit?: boolean } = {}
): Promise<string[]> {
	let query = supabase
		.from('transaction_access')
		.select('transaction_id')
		.eq('user_id', userId)
		.eq('can_read', true);

	if (options.canEdit) {
		query = query.eq('can_edit', true);
	}

	const { data, error } = await query;
	if (error || !data) return [];
	return data.map((row) => row.transaction_id);
}

type TransactionRelationInput = {
	category_id?: string | null;
	subcategory_id?: string | null;
	owner_profile_id?: string | null;
	paid_by_user_id?: string | null;
};

type TransactionPatch = {
	category_id?: string | null;
	subcategory_id?: string | null;
	owner_profile_id?: string | null;
	paid_by_user_id?: string | null;
	split_method?: string;
	review_status?: string;
	updated_at?: string;
};

type CategoryLookup = {
	data: { parent_id: string | null; created_by_user_id: string | null } | null;
	error: unknown | null;
};

type EntityLookup = {
	data: unknown | null;
	error: unknown | null;
};

function categoryValidationError(
	categoryId: string | null | undefined,
	category: CategoryLookup,
	userId: string | undefined
): string | null {
	if (!categoryId) return null;
	if (category.error || !category.data || category.data.parent_id) {
		return 'Categoria inválida para este grupo';
	}
	if (category.data.created_by_user_id && category.data.created_by_user_id !== userId) {
		return 'Categoria pertence ao gabarito de outro usuário';
	}
	return null;
}

function subcategoryValidationError(
	categoryId: string | null | undefined,
	subcategoryId: string | null | undefined,
	subcategory: CategoryLookup,
	userId: string | undefined
): string | null {
	if (!subcategoryId) return null;
	if (subcategory.error || !subcategory.data || !subcategory.data.parent_id) {
		return 'Subcategoria inválida para este grupo';
	}
	if (subcategory.data.created_by_user_id && subcategory.data.created_by_user_id !== userId) {
		return 'Subcategoria pertence ao gabarito de outro usuário';
	}
	if (!categoryId) return 'Selecione uma categoria antes da subcategoria';
	if (subcategory.data.parent_id !== categoryId) {
		return 'Subcategoria não pertence à categoria selecionada';
	}
	return null;
}

function entityValidationError(
	id: string | null | undefined,
	entity: EntityLookup,
	message: string
): string | null {
	return id && (entity.error || !entity.data) ? message : null;
}

export async function validateTransactionRelations(
	supabase: SupabaseClient<Database>,
	householdId: string,
	data: TransactionRelationInput,
	userId?: string
): Promise<string | null> {
	const [category, subcategory, profile, payer] = await Promise.all([
		data.category_id
			? supabase
					.from('categories')
					.select('id, parent_id, created_by_user_id')
					.eq('id', data.category_id)
					.eq('household_id', householdId)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null }),
		data.subcategory_id
			? supabase
					.from('categories')
					.select('id, parent_id, created_by_user_id')
					.eq('id', data.subcategory_id)
					.eq('household_id', householdId)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null }),
		data.owner_profile_id
			? supabase
					.from('financial_profiles')
					.select('id')
					.eq('id', data.owner_profile_id)
					.eq('household_id', householdId)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null }),
		data.paid_by_user_id
			? supabase
					.from('household_members')
					.select('user_id')
					.eq('household_id', householdId)
					.eq('user_id', data.paid_by_user_id)
					.maybeSingle()
			: Promise.resolve({ data: null, error: null })
	]);

	return (
		categoryValidationError(data.category_id, category, userId) ??
		subcategoryValidationError(data.category_id, data.subcategory_id, subcategory, userId) ??
		entityValidationError(data.owner_profile_id, profile, 'Perfil financeiro inválido para este grupo') ??
		entityValidationError(data.paid_by_user_id, payer, 'Pagador inválido para este grupo')
	);
}

export async function canEditTransaction(
	supabase: SupabaseClient<Database>,
	transactionId: string,
	userId: string
): Promise<boolean> {
	const { data, error } = await supabase
		.from('transaction_access')
		.select('id')
		.eq('transaction_id', transactionId)
		.eq('user_id', userId)
		.eq('can_edit', true)
		.maybeSingle();
	return !error && !!data;
}

export async function updateTransactionForHousehold(
	supabase: SupabaseClient<Database>,
	transactionId: string,
	householdId: string,
	patch: TransactionPatch
): Promise<{ error: { message: string } | null }> {
	const { error } = await supabase
		.from('transactions')
		.update(patch)
		.eq('id', transactionId)
		.eq('household_id', householdId);
	return { error };
}
