import type { PageServerLoad, Actions } from './$types';
import { transactionSchema, type TransactionInput } from '$lib/schemas/transaction';
import { getUserHouseholdId, getHouseholdMembers } from '$lib/server/household';
import { validateTransactionRelations } from '$lib/server/access';
import { learnFromTransactionAdjustment } from '$lib/server/learning';
import { loadCategoriesForUser } from '$lib/server/categories';
import { supabaseAdmin } from '$lib/server/supabase';
import { fail, redirect } from '@sveltejs/kit';

type DraftTransactionRow = {
	date: string;
	description: string;
	merchant: string;
	amount: string;
	source_name: string;
	paid_by_user_id: string;
	owner_profile_id: string;
	split_method: string;
	category_id: string;
	subcategory_id: string;
};

type InsertedTransaction = {
	id: string;
	owner_profile_id: string | null;
	paid_by_user_id: string | null;
	category_id: string | null;
	subcategory_id: string | null;
};

function emptyDraftRow(): DraftTransactionRow {
	return {
		date: '',
		description: '',
		merchant: '',
		amount: '',
		source_name: '',
		paid_by_user_id: '',
		owner_profile_id: '',
		split_method: 'income_proportional',
		category_id: '',
		subcategory_id: ''
	};
}

function parseDraftRows(formData: FormData): DraftTransactionRow[] {
	const rows = new Map<number, DraftTransactionRow>();

	for (const [key, value] of formData.entries()) {
		const match = /^rows\[(\d+)\]\.(.+)$/.exec(key);
		if (!match) continue;

		const rowIndex = Number(match[1]);
		const field = match[2] as keyof DraftTransactionRow;
		const row = rows.get(rowIndex) ?? emptyDraftRow();

		if (field in row) {
			row[field] = String(value ?? '').trim();
			rows.set(rowIndex, row);
		}
	}

	return Array.from(rows.entries())
		.sort(([a], [b]) => a - b)
		.map(([, row]) => row);
}

function isDraftRowEmpty(row: DraftTransactionRow): boolean {
	return Object.entries(row).every(([field, value]) => field === 'split_method' || value === '');
}

function formatZodErrors(fieldErrors: Record<string, string[] | undefined>): string {
	return Object.entries(fieldErrors)
		.flatMap(([, errors]) => errors ?? [])
		.join(' ');
}

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) {
		return { categories: [], profiles: [], members: [] };
	}

	const [categories, { data: profiles }, { data: members }, { data: household }] = await Promise.all([
		loadCategoriesForUser(supabaseAdmin, householdId, user.id),
		supabase
			.from('financial_profiles')
			.select('id, household_id, user_id, name, type, created_at')
			.eq('household_id', householdId)
			.order('type', { ascending: false })
			.order('name'),
		supabase
			.from('household_members')
			.select('user_id, profiles!inner(display_name)')
			.eq('household_id', householdId),
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

		const formData = await request.formData();
		const rawRows = parseDraftRows(formData);
		const rows = rawRows.length > 0 ? rawRows : Array.from({ length: 4 }, () => emptyDraftRow());
		const filledRows = rows
			.map((row, index) => ({ row, index }))
			.filter(({ row }) => !isDraftRowEmpty(row));

		if (filledRows.length === 0) {
			return fail(400, {
				success: false,
				message: 'Preencha ao menos uma transação',
				rows
			});
		}

		const parsedRows: Array<{ index: number; data: TransactionInput }> = [];
		const rowErrors: Record<number, string> = {};

		for (const { row, index } of filledRows) {
			const parseResult = transactionSchema.safeParse(row);
			if (!parseResult.success) {
				rowErrors[index] = formatZodErrors(parseResult.error.flatten().fieldErrors);
				continue;
			}

			parsedRows.push({ index, data: parseResult.data });
		}

		if (Object.keys(rowErrors).length > 0) {
			return fail(400, {
				success: false,
				message: 'Revise as linhas com erro antes de registrar',
				rows,
				rowErrors
			});
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, { success: false, message: 'Usuário não pertence a um grupo', rows });
		}

		for (const { index, data } of parsedRows) {
			const relationError = await validateTransactionRelations(supabase, householdId, data, user.id);
			if (relationError) {
				rowErrors[index] = relationError;
			}
		}

		if (Object.keys(rowErrors).length > 0) {
			return fail(400, {
				success: false,
				message: 'Algumas linhas precisam de ajuste antes do registro',
				rows,
				rowErrors
			});
		}

		const insertPayload = parsedRows.map(({ data }) => ({
			...data,
			reference_month: data.reference_month ?? data.date.slice(0, 7),
			household_id: householdId,
			created_by_user_id: user.id
		}));

		const [{ data: insertedTransactions, error: txError }, householdMembersResult, profileResult] =
			await Promise.all([
				supabase
					.from('transactions')
					.insert(insertPayload)
					.select('id, owner_profile_id, paid_by_user_id, category_id, subcategory_id'),
				getHouseholdMembers(supabase, householdId),
				supabase.from('financial_profiles').select('id, type, user_id').eq('household_id', householdId)
			]);

		if (txError || !insertedTransactions?.length) {
			return fail(500, {
				success: false,
				message: txError?.message ?? 'Erro ao criar transações',
				rows
			});
		}

		const householdMembers = householdMembersResult;
		const profileById = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile]));
		const accessRows: { transaction_id: string; user_id: string; can_read: boolean; can_edit: boolean }[] = [];

		for (const tx of insertedTransactions as InsertedTransaction[]) {
			accessRows.push({ transaction_id: tx.id, user_id: user.id, can_read: true, can_edit: true });

			if (tx.owner_profile_id) {
				const profile = profileById.get(tx.owner_profile_id);
				if (profile?.type === 'shared') {
					for (const memberId of householdMembers) {
						if (memberId === user.id) continue;
						accessRows.push({ transaction_id: tx.id, user_id: memberId, can_read: true, can_edit: true });
					}
				} else if (profile?.type === 'individual' && profile.user_id && profile.user_id !== user.id) {
					accessRows.push({ transaction_id: tx.id, user_id: profile.user_id, can_read: true, can_edit: true });
				}
			}

			if (tx.paid_by_user_id && !accessRows.some((row) => row.transaction_id === tx.id && row.user_id === tx.paid_by_user_id)) {
				accessRows.push({ transaction_id: tx.id, user_id: tx.paid_by_user_id, can_read: true, can_edit: false });
			}
		}

		const { error: accessError } = await supabase.from('transaction_access').insert(accessRows);
		if (accessError) {
			return fail(500, { success: false, message: accessError.message, rows });
		}

		await Promise.all(
			(insertedTransactions as InsertedTransaction[]).map((tx) =>
				learnFromTransactionAdjustment(supabase, {
					householdId,
					userId: user.id,
					transactionId: tx.id,
					categoryId: tx.category_id,
					subcategoryId: tx.category_id ? tx.subcategory_id : null,
					ownerProfileId: tx.owner_profile_id
				})
			)
		);

		redirect(303, '/app/transactions');
	}
};
