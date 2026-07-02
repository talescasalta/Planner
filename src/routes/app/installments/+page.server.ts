import type { PageServerLoad } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import { getReadableTransactionIds } from '$lib/server/access';
import { supabaseAdmin } from '$lib/server/supabase';
import { projectFutureInstallments, type InstallmentSourceTransaction } from '$lib/server/installments';

const EMPTY = { months: [], total: 0, count: 0 };

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return EMPTY;

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return EMPTY;

	// Only project installments the user is actually allowed to read.
	const readableTransactionIds = await getReadableTransactionIds(supabase, user.id);
	if (readableTransactionIds.length === 0) return EMPTY;

	const { data, error } = await supabaseAdmin
		.from('transactions')
		.select(
			`installment_number, installment_total, installment_group_key, amount, reference_month, date, clean_description, description,
			category:categories!transactions_category_id_fkey ( name )`
		)
		.eq('household_id', householdId)
		.in('id', readableTransactionIds)
		.not('installment_group_key', 'is', null);

	if (error) {
		console.error('Error loading installments:', error);
		return EMPTY;
	}

	const rows: InstallmentSourceTransaction[] = (data ?? []).map((t: any) => ({
		installment_number: t.installment_number,
		installment_total: t.installment_total,
		installment_group_key: t.installment_group_key,
		amount: Number(t.amount),
		reference_month: t.reference_month,
		date: t.date,
		clean_description: t.clean_description,
		description: t.description,
		category_display_name: t.category?.name ?? null
	}));

	return projectFutureInstallments(rows);
};
