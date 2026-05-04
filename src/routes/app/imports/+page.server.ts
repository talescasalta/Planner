import type { PageServerLoad, Actions } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { parseCsvBuffer, buildDuplicateKey, detectMapping, type ParsedRow } from '$lib/server/csv-parser';
import { getUserHouseholdId, getHouseholdMembers } from '$lib/server/household';
import { classifyTransactions } from '$lib/server/classifier';
import { supabaseAdmin } from '$lib/server/supabase';
import { isHouseholdAdmin } from '$lib/server/access';
import { fail, redirect } from '@sveltejs/kit';

async function loadExistingKeysForRange(
	supabase: SupabaseClient<Database>,
	householdId: string,
	rows: ParsedRow[]
): Promise<Set<string>> {
	if (rows.length === 0) return new Set();
	let minDate = rows[0].date;
	let maxDate = rows[0].date;
	for (const r of rows) {
		if (r.date < minDate) minDate = r.date;
		if (r.date > maxDate) maxDate = r.date;
	}
	const { data } = await supabase
		.from('transactions')
		.select('date, description, amount')
		.eq('household_id', householdId)
		.gte('date', minDate)
		.lte('date', maxDate);
	return new Set(
		(data ?? []).map((t) => `${t.date}|${t.description?.toUpperCase().trim() ?? ''}|${t.amount}`)
	);
}

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	preview: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const file = formData.get('file') as File;
		const referenceMonth = formData.get('reference_month') as string;

		if (!file || file.size === 0) {
			return fail(400, { success: false, message: 'Arquivo não enviado' });
		}
		if (!referenceMonth) {
			return fail(400, { success: false, message: 'Mês de referência não informado' });
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		const mapping = detectMapping(buffer) ?? {
			dateColumn: 'date',
			descriptionColumn: 'title',
			amountColumn: 'amount',
			currency: 'BRL'
		};
		const rows = parseCsvBuffer(buffer, mapping);

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });
		}

		const existingKeys = await loadExistingKeysForRange(supabase, householdId, rows);

		const previewRows = rows.slice(0, 10).map((r) => ({
			...r,
			duplicate: existingKeys.has(buildDuplicateKey(r))
		}));

		return {
			success: true,
			preview: previewRows,
			total: rows.length,
			duplicates: rows.filter((r) => existingKeys.has(buildDuplicateKey(r))).length,
			filename: file.name,
			reference_month: referenceMonth
		};
	},

	confirm: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const file = formData.get('file') as File;
		const referenceMonth = formData.get('reference_month') as string;

		if (!file || file.size === 0) {
			return fail(400, { success: false, message: 'Arquivo não enviado' });
		}
		if (!referenceMonth) {
			return fail(400, { success: false, message: 'Mês de referência não informado' });
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		const mapping = detectMapping(buffer) ?? {
			dateColumn: 'date',
			descriptionColumn: 'title',
			amountColumn: 'amount',
			currency: 'BRL'
		};
		const rows = parseCsvBuffer(buffer, mapping);

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });
		}

		const { data: importRecord, error: importError } = await supabaseAdmin
			.from('transaction_imports')
			.insert({
				household_id: householdId,
				created_by_user_id: user.id,
				source_filename: file.name,
				status: 'parsed',
				row_count: rows.length,
				reference_month: referenceMonth
			})
			.select()
			.single();

		if (importError || !importRecord) {
			return fail(500, { success: false, message: importError?.message ?? 'Erro ao registrar importação' });
		}

		const existingKeys = await loadExistingKeysForRange(supabase, householdId, rows);

		const newRows = rows.filter((r) => !existingKeys.has(buildDuplicateKey(r)));

		if (newRows.length > 0) {
			const householdMembers = await getHouseholdMembers(supabaseAdmin, householdId);

			const txInserts = newRows.map((r) => ({
				household_id: householdId,
				date: r.date,
				description: r.description,
				clean_description: r.clean_description,
				amount: r.amount,
				currency: r.currency,
				reference_month: referenceMonth,
				classification_method: 'imported',
				review_status: 'needs_review',
				created_by_user_id: user.id
			}));

			const { data: insertedTxs, error: txError } = await supabaseAdmin
				.from('transactions')
				.insert(txInserts)
				.select('id, amount, date, description, clean_description');

			if (txError) {
				console.error('[imports/confirm] transactions insert failed', txError);
				return fail(500, { success: false, message: txError.message });
			}

			const accessRows: { transaction_id: string; user_id: string; can_read: boolean; can_edit: boolean }[] = [];
			for (const tx of insertedTxs ?? []) {
				for (const memberId of householdMembers) {
					accessRows.push({
						transaction_id: tx.id,
						user_id: memberId,
						can_read: true,
						can_edit: true
					});
				}
			}

			if (accessRows.length > 0) {
				const { error: accessError } = await supabaseAdmin.from('transaction_access').insert(accessRows);
				if (accessError) {
					console.error('[imports/confirm] transaction_access insert failed', accessError);
					return fail(500, { success: false, message: accessError.message });
				}
			}

			const insertedIds = (insertedTxs ?? []).map((t) => t.id);
			if (insertedIds.length > 0) {
				await classifyTransactions(supabaseAdmin, householdId, insertedIds, user.id);
			}
		}

		await supabaseAdmin
			.from('transaction_imports')
			.update({ status: 'classified', row_count: newRows.length })
			.eq('id', importRecord.id);

		redirect(303, '/app/transactions');
	},

	repair_access: async ({ locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Sem grupo' });

		const isAdmin = await isHouseholdAdmin(supabase, householdId, user.id);
		if (!isAdmin) {
			return fail(403, { success: false, message: 'Apenas administradores podem reparar acessos' });
		}

		const members = await getHouseholdMembers(supabaseAdmin, householdId);
		if (members.length === 0) {
			return fail(500, { success: false, message: 'Nenhum membro encontrado' });
		}

		const { data: txs, error: txErr } = await supabaseAdmin
			.from('transactions')
			.select('id')
			.eq('household_id', householdId);
		if (txErr) return fail(500, { success: false, message: txErr.message });

		const txIds = (txs ?? []).map((t) => t.id);
		if (txIds.length === 0) {
			return { success: true, message: 'Nenhuma transação para reparar' };
		}

		const { data: existing } = await supabaseAdmin
			.from('transaction_access')
			.select('transaction_id, user_id')
			.in('transaction_id', txIds);

		const existingSet = new Set((existing ?? []).map((r) => `${r.transaction_id}|${r.user_id}`));

		const toInsert: { transaction_id: string; user_id: string; can_read: boolean; can_edit: boolean }[] = [];
		for (const tid of txIds) {
			for (const memberId of members) {
				if (existingSet.has(`${tid}|${memberId}`)) continue;
				toInsert.push({ transaction_id: tid, user_id: memberId, can_read: true, can_edit: true });
			}
		}

		if (toInsert.length === 0) {
			return { success: true, message: 'Acesso já estava completo' };
		}

		const { error: insErr } = await supabaseAdmin.from('transaction_access').insert(toInsert);
		if (insErr) return fail(500, { success: false, message: insErr.message });

		return { success: true, message: `${toInsert.length} permissões adicionadas em ${txIds.length} transações` };
	}
};
