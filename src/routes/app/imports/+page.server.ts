import type { PageServerLoad, Actions } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import {
	buildImportDedupKey,
	detectMapping,
	type CsvSourceType,
	type ParsedRow
} from '$lib/server/csv-parser';
import { resolveImportMapping } from '$lib/server/import-mapping';
import { extractRowsFromImage, extractRowsFromText } from '$lib/server/import-extract';

function readSourceType(formData: FormData): CsvSourceType {
	const raw = formData.get('source_type');
	if (raw === 'credit_card' || raw === 'vale_alimentacao' || raw === 'vale_refeicao') return raw;
	return 'bank_account';
}

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const EMPTY_ROWS_MESSAGE =
	'Não foi possível identificar transações no conteúdo enviado. Verifique se o arquivo, print ou texto colado mostra data, descrição e valor.';

interface ResolvedImportInput {
	rows: ParsedRow[];
	sourceType: CsvSourceType;
	mappingSource: 'deterministic' | 'llm' | 'vision';
	confidence: number;
	notes?: string;
	sourceName: string;
}

// Accepts a CSV file, a statement screenshot or pasted text and normalizes
// everything into parsed transaction rows.
async function resolveImportInput(
	formData: FormData,
	referenceMonth: string
): Promise<ResolvedImportInput | null> {
	const sourceType = readSourceType(formData);
	const file = formData.get('file') as File | null;
	const pastedText = (formData.get('pasted_text')?.toString() ?? '').trim();

	if (file && file.size > 0) {
		const buffer = Buffer.from(await file.arrayBuffer());
		if (IMAGE_MIME_TYPES.has(file.type)) {
			const extraction = await extractRowsFromImage(buffer, file.type, sourceType, referenceMonth);
			return {
				rows: extraction.rows,
				sourceType,
				mappingSource: 'vision',
				confidence: extraction.confidence,
				notes: extraction.notes,
				sourceName: file.name || 'print-colado.png'
			};
		}
		const resolved = await resolveImportMapping(buffer, sourceType);
		return {
			rows: resolved.rows,
			sourceType: resolved.sourceType,
			mappingSource: resolved.mappingSource,
			confidence: resolved.confidence,
			notes: resolved.notes,
			sourceName: file.name
		};
	}

	if (pastedText) {
		const buffer = Buffer.from(pastedText, 'utf-8');
		// Pasted CSVs (with recognizable headers) go through the regular column
		// mapping; anything else (text copied from an app or site) goes to LLM
		// extraction.
		if (detectMapping(buffer)) {
			const resolved = await resolveImportMapping(buffer, sourceType);
			if (resolved.rows.length > 0) {
				return {
					rows: resolved.rows,
					sourceType: resolved.sourceType,
					mappingSource: resolved.mappingSource,
					confidence: resolved.confidence,
					notes: resolved.notes,
					sourceName: 'texto-colado.csv'
				};
			}
		}
		const extraction = await extractRowsFromText(pastedText, sourceType, referenceMonth);
		return {
			rows: extraction.rows,
			sourceType,
			mappingSource: 'llm',
			confidence: extraction.confidence,
			notes: extraction.notes,
			sourceName: 'texto-colado.txt'
		};
	}

	return null;
}
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
		.select('import_dedup_key')
		.eq('household_id', householdId)
		.gte('date', minDate)
		.lte('date', maxDate);
	return new Set((data ?? []).map((t) => t.import_dedup_key).filter((key): key is string => !!key));
}

async function markImportFailed(importId: string, message: string) {
	console.error('[imports/confirm]', message);
	await supabaseAdmin
		.from('transaction_imports')
		.update({ status: 'failed' })
		.eq('id', importId);
}

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	preview: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const referenceMonth = formData.get('reference_month') as string;

		if (!referenceMonth) {
			return fail(400, { success: false, message: 'Mês de referência não informado' });
		}

		const resolved = await resolveImportInput(formData, referenceMonth);
		if (!resolved) {
			return fail(400, {
				success: false,
				message: 'Envie um arquivo CSV, uma imagem (print) ou cole o conteúdo da fatura.'
			});
		}
		const rows = resolved.rows;
		if (rows.length === 0) {
			return fail(400, { success: false, message: resolved.notes || EMPTY_ROWS_MESSAGE });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });
		}

		const existingKeys = await loadExistingKeysForRange(supabase, householdId, rows);

		const previewRows = rows.slice(0, 10).map((r) => ({
			...r,
			duplicate: existingKeys.has(buildImportDedupKey(r))
		}));

		return {
			success: true,
			preview: previewRows,
			total: rows.length,
			duplicates: rows.filter((r) => existingKeys.has(buildImportDedupKey(r))).length,
			filename: resolved.sourceName,
			reference_month: referenceMonth,
			source_type: resolved.sourceType,
			mapping_source: resolved.mappingSource,
			mapping_confidence: resolved.confidence,
			mapping_notes: resolved.notes
		};
	},

	confirm: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const referenceMonth = formData.get('reference_month') as string;

		if (!referenceMonth) {
			return fail(400, { success: false, message: 'Mês de referência não informado' });
		}

		const resolved = await resolveImportInput(formData, referenceMonth);
		if (!resolved) {
			return fail(400, {
				success: false,
				message: 'Envie um arquivo CSV, uma imagem (print) ou cole o conteúdo da fatura.'
			});
		}
		const rows = resolved.rows;
		if (rows.length === 0) {
			return fail(400, { success: false, message: resolved.notes || EMPTY_ROWS_MESSAGE });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });
		}

		const { data: importRecord, error: importError } = await supabaseAdmin
			.from('transaction_imports')
			.insert({
				household_id: householdId,
				created_by_user_id: user.id,
				source_filename: resolved.sourceName,
				source_type: resolved.sourceType,
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

		const newRows = rows.filter((r) => !existingKeys.has(buildImportDedupKey(r)));

		let insertedCount = 0;
		if (newRows.length > 0) {
			const txInserts = newRows.map((r) => ({
				household_id: householdId,
				date: r.date,
				description: r.description,
				clean_description: r.clean_description,
				amount: r.amount,
				currency: r.currency,
				source_type: resolved.sourceType,
				reference_month: referenceMonth,
				import_dedup_key: buildImportDedupKey(r),
				installment_number: r.installment_number ?? null,
				installment_total: r.installment_total ?? null,
				installment_group_key: r.installment_group_key ?? null,
				classification_method: 'imported',
				review_status: 'needs_review',
				created_by_user_id: user.id
			}));

			const { data: insertedTxs, error: txError } = await supabaseAdmin
				.from('transactions')
				.upsert(txInserts, {
					onConflict: 'household_id,reference_month,import_dedup_key',
					ignoreDuplicates: true
				})
				.select('id, amount, date, description, clean_description');

			if (txError) {
				await markImportFailed(importRecord.id, `transactions insert failed: ${txError.message}`);
				return fail(500, { success: false, message: txError.message });
			}

			if (!insertedTxs) {
				await markImportFailed(
					importRecord.id,
					`transactions insert returned no rows for ${txInserts.length} requested rows`
				);
				return fail(500, {
					success: false,
					message: 'A importação não conseguiu confirmar as transações gravadas. Tente novamente.'
				});
			}
			insertedCount = insertedTxs.length;

			const accessRows: { transaction_id: string; user_id: string; can_read: boolean; can_edit: boolean }[] = [];
			for (const tx of insertedTxs ?? []) {
				accessRows.push({
					transaction_id: tx.id,
					user_id: user.id,
					can_read: true,
					can_edit: true
				});
			}

			if (accessRows.length > 0) {
				const { error: accessError } = await supabaseAdmin.from('transaction_access').insert(accessRows);
				if (accessError) {
					await markImportFailed(importRecord.id, `transaction_access insert failed: ${accessError.message}`);
					return fail(500, { success: false, message: accessError.message });
				}
			}

			const insertedIds = (insertedTxs ?? []).map((t) => t.id);
			if (insertedIds.length > 0) {
				const { count: persistedCount, error: persistedError } = await supabaseAdmin
					.from('transactions')
					.select('id', { count: 'exact', head: true })
					.in('id', insertedIds)
					.eq('household_id', householdId);
				if (persistedError || persistedCount !== insertedIds.length) {
					await markImportFailed(
						importRecord.id,
						`persisted transaction count mismatch: ${persistedCount ?? 0}/${insertedIds.length}`
					);
					return fail(500, {
						success: false,
						message: 'A importação não encontrou as transações recém-gravadas. Nada foi classificado.'
					});
				}

				try {
					await classifyTransactions(supabaseAdmin, householdId, insertedIds, user.id);
				} catch (classificationError) {
					await markImportFailed(importRecord.id, `classification failed: ${String(classificationError)}`);
					return fail(500, {
						success: false,
						message: 'As transações foram importadas, mas a classificação automática falhou. Tente classificar novamente.'
					});
				}
			}
		}

		await supabaseAdmin
			.from('transaction_imports')
			.update({ status: 'classified', row_count: insertedCount })
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

		const { data: txs, error: txErr } = await supabaseAdmin
			.from('transactions')
			.select('id, created_by_user_id, owner_profile:financial_profiles!transactions_owner_profile_id_fkey ( type, user_id )')
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

		const householdMembers = await getHouseholdMembers(supabaseAdmin, householdId);
		const toInsert: { transaction_id: string; user_id: string; can_read: boolean; can_edit: boolean }[] = [];
		for (const tx of txs ?? []) {
			const profile = tx.owner_profile as { type?: string; user_id?: string | null } | null;
			const targetUserIds =
				profile?.type === 'shared'
					? householdMembers
					: Array.from(new Set([tx.created_by_user_id, profile?.user_id].filter((id): id is string => !!id)));

			for (const targetUserId of targetUserIds) {
				if (existingSet.has(`${tx.id}|${targetUserId}`)) continue;
				toInsert.push({
					transaction_id: tx.id,
					user_id: targetUserId,
					can_read: true,
					can_edit: targetUserId === tx.created_by_user_id || profile?.type === 'shared'
				});
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
