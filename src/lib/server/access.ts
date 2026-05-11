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

	if (data.category_id && (category.error || !category.data || category.data.parent_id)) {
		return 'Categoria inválida para este grupo';
	}
	if (data.category_id && category.data?.created_by_user_id && category.data.created_by_user_id !== userId) {
		return 'Categoria pertence ao gabarito de outro usuário';
	}
	if (data.subcategory_id && (subcategory.error || !subcategory.data || !subcategory.data.parent_id)) {
		return 'Subcategoria inválida para este grupo';
	}
	if (
		data.subcategory_id &&
		subcategory.data?.created_by_user_id &&
		subcategory.data.created_by_user_id !== userId
	) {
		return 'Subcategoria pertence ao gabarito de outro usuário';
	}
	if (data.subcategory_id && !data.category_id) {
		return 'Selecione uma categoria antes da subcategoria';
	}
	if (
		data.subcategory_id &&
		data.category_id &&
		subcategory.data?.parent_id !== data.category_id
	) {
		return 'Subcategoria não pertence à categoria selecionada';
	}
	if (data.owner_profile_id && (profile.error || !profile.data)) {
		return 'Perfil financeiro inválido para este grupo';
	}
	if (data.paid_by_user_id && (payer.error || !payer.data)) {
		return 'Pagador inválido para este grupo';
	}

	return null;
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
