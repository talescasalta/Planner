import type { PageServerLoad, Actions } from './$types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { getUserHouseholdId, attachPayerProfiles } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { getReadableTransactionIds, validateTransactionRelations } from '$lib/server/access';
import { learnFromTransactionAdjustment } from '$lib/server/learning';
import { filterCategoriesForUser } from '$lib/server/gabarito';
import { loadCategoriesForUser, loadUserCategoryExclusions } from '$lib/server/categories';
import { fail, redirect } from '@sveltejs/kit';

const PAGE_SIZE = 100;
const ALL_MONTHS = 'all';
const ALL_FILTERS = 'all';
const UNKNOWN_SOURCE = 'unknown';
const VALID_SOURCE_TYPES = new Set(['credit_card', 'bank_account', UNKNOWN_SOURCE]);
const VALID_REVIEW_STATUSES = new Set(['needs_review', 'confirmed', 'ignored']);

type ClassificationSuggestionLike = {
	category?: unknown;
	subcategory?: unknown;
};

type TransactionWithDisplay = {
	category?: { name: string | null } | null;
	subcategory?: { name: string | null } | null;
	category_id?: string | null;
	subcategory_id?: string | null;
	classification_suggestion?: ClassificationSuggestionLike | null;
};

function cleanName(value: FormDataEntryValue | null): string {
	return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function emptyPage() {
	return {
		transactions: [],
		categories: [],
		profiles: [],
		monthOptions: [],
		selectedMonth: '',
		filters: { sourceType: ALL_FILTERS, categoryId: '', subcategoryId: '', status: ALL_FILTERS },
		page: 0,
		pageSize: PAGE_SIZE,
		hasMore: false,
		summary: { count: 0, expenses: 0, credits: 0, balance: 0 }
	};
}

function monthFromDate(date: string | null | undefined): string {
	return date?.slice(0, 7) ?? '';
}

function suggestionText(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanFilter(value: string | null | undefined): string {
	return String(value ?? '').trim();
}

function readFilters(url: URL) {
	const sourceType = cleanFilter(url.searchParams.get('source_type'));
	const status = cleanFilter(url.searchParams.get('status'));
	return {
		sourceType: VALID_SOURCE_TYPES.has(sourceType) ? sourceType : ALL_FILTERS,
		categoryId: cleanFilter(url.searchParams.get('category_id')),
		subcategoryId: cleanFilter(url.searchParams.get('subcategory_id')),
		status: VALID_REVIEW_STATUSES.has(status) ? status : ALL_FILTERS
	};
}

function appendFilters(params: URLSearchParams, formData: FormData) {
	const sourceType = cleanFilter(formData.get('source_type_filter')?.toString());
	const categoryId = cleanFilter(formData.get('category_id_filter')?.toString());
	const subcategoryId = cleanFilter(formData.get('subcategory_id_filter')?.toString());
	const status = cleanFilter(formData.get('status_filter')?.toString());
	if (sourceType && sourceType !== ALL_FILTERS) params.set('source_type', sourceType);
	if (categoryId) params.set('category_id', categoryId);
	if (subcategoryId) params.set('subcategory_id', subcategoryId);
	if (status && status !== ALL_FILTERS) params.set('status', status);
}

function withClassificationDisplay<T extends TransactionWithDisplay>(transaction: T) {
	const suggestedCategory = suggestionText(transaction.classification_suggestion?.category);
	const suggestedSubcategory = suggestionText(transaction.classification_suggestion?.subcategory);
	const categoryName = transaction.category?.name ?? suggestedCategory;
	const subcategoryName = transaction.subcategory?.name ?? suggestedSubcategory;
	const hasSavedClassification = !!transaction.category_id || !!transaction.subcategory_id;
	const hasSuggestion = !!suggestedCategory || !!suggestedSubcategory;

	return {
		...transaction,
		category_display_name: categoryName ?? null,
		subcategory_display_name: subcategoryName ?? null,
		classification_display_source: hasSavedClassification ? 'saved' : hasSuggestion ? 'suggestion' : 'empty'
	};
}

async function getEditableTransactionIds(
	userSupabase: SupabaseClient<Database>,
	userId: string,
	transactionIds: string[]
): Promise<Set<string>> {
	if (transactionIds.length === 0) return new Set();
	const { data } = await userSupabase
		.from('transaction_access')
		.select('transaction_id')
		.eq('user_id', userId)
		.eq('can_edit', true)
		.in('transaction_id', transactionIds);
	return new Set((data ?? []).map((row) => row.transaction_id));
}

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		return emptyPage();
	}

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) {
		return emptyPage();
	}

	const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
	const from = page * PAGE_SIZE;
	const to = from + PAGE_SIZE;
	const requestedMonth = url.searchParams.get('month') ?? '';
	const filters = readFilters(url);
	const readableTransactionIds = await getReadableTransactionIds(supabase, user.id);
	if (readableTransactionIds.length === 0) {
		return { ...emptyPage(), page, filters };
	}

	const { data: monthRows } = await supabaseAdmin
		.from('transactions')
		.select('reference_month, date')
		.eq('household_id', householdId)
		.in('id', readableTransactionIds)
		.order('reference_month', { ascending: false, nullsFirst: false })
		.order('date', { ascending: false });

	const monthOptions = Array.from(
		new Set((monthRows ?? []).map((row) => row.reference_month ?? monthFromDate(row.date)).filter(Boolean))
	).sort((a, b) => b.localeCompare(a));
	const selectedMonth =
		requestedMonth === ALL_MONTHS ? ALL_MONTHS : requestedMonth || monthOptions[0] || '';

	const applyFilters = (query: any) => {
		if (selectedMonth && selectedMonth !== ALL_MONTHS) query = query.eq('reference_month', selectedMonth);
		if (filters.sourceType === UNKNOWN_SOURCE) query = query.is('source_type', null);
		else if (filters.sourceType !== ALL_FILTERS) query = query.eq('source_type', filters.sourceType);
		if (filters.categoryId) query = query.eq('category_id', filters.categoryId);
		if (filters.subcategoryId) query = query.eq('subcategory_id', filters.subcategoryId);
		if (filters.status !== ALL_FILTERS) query = query.eq('review_status', filters.status);
		return query;
	};

	const [
		{ data: transactions, error },
		{ data: summaryRows },
		{ data: categories },
		{ data: profiles },
		{ data: household },
		excludedCategoryIds
	] = await Promise.all([
		(() => {
			let query = supabaseAdmin
			.from('transactions')
			.select(`
				*,
				category:categories!transactions_category_id_fkey ( id, name ),
				subcategory:categories!transactions_subcategory_id_fkey ( id, name ),
				owner_profile:financial_profiles ( id, name, type )
			`)
			.eq('household_id', householdId)
			.in('id', readableTransactionIds)
			query = applyFilters(query)
				.order('date', { ascending: false })
				.range(from, to);
			return query;
		})(),
		(() => {
			let query = supabaseAdmin
				.from('transactions')
				.select('amount')
				.eq('household_id', householdId)
				.in('id', readableTransactionIds);
			if (filters.status === ALL_FILTERS) query = query.neq('review_status', 'ignored');
			query = applyFilters(query);
			return query;
		})(),
		supabaseAdmin
			.from('categories')
			.select('id, name, parent_id, created_by_user_id, is_default, created_at, household_id')
			.eq('household_id', householdId)
			.order('name'),
		supabaseAdmin
			.from('financial_profiles')
			.select('id, household_id, user_id, name, type, created_at')
			.eq('household_id', householdId)
			.order('type', { ascending: false })
			.order('name'),
		supabaseAdmin.from('households').select('id, name').eq('id', householdId).single(),
		loadUserCategoryExclusions(supabaseAdmin, householdId, user.id)
	]);

	if (error) {
		console.error('Error loading transactions:', error);
		return { ...emptyPage(), page, monthOptions, selectedMonth, filters };
	}

	const all = transactions ?? [];
	const enriched = (await attachPayerProfiles(all)).map(withClassificationDisplay);
	const selectedCategoryIds = new Set(
		enriched.flatMap((tx) => [tx.category_id, tx.subcategory_id]).filter((id): id is string => !!id)
	);
	const hasMore = enriched.length > PAGE_SIZE;
	const assignmentProfiles = (profiles ?? [])
		.filter((p) => p.type === 'shared' || !!p.user_id)
		.map((p) => (p.type === 'shared' ? { ...p, name: household?.name ?? p.name } : p));
	const amounts = summaryRows ?? [];
	const summary = {
		count: amounts.length,
		expenses: amounts.filter((row) => Number(row.amount) < 0).reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0),
		credits: amounts.filter((row) => Number(row.amount) > 0).reduce((sum, row) => sum + Number(row.amount), 0),
		balance: amounts.reduce((sum, row) => sum + Number(row.amount), 0)
	};

	return {
		transactions: hasMore ? enriched.slice(0, PAGE_SIZE) : enriched,
		categories: filterCategoriesForUser(categories ?? [], user.id, excludedCategoryIds, selectedCategoryIds),
		profiles: assignmentProfiles,
		monthOptions,
		selectedMonth,
		filters,
		page,
		pageSize: PAGE_SIZE,
		hasMore,
		summary
	};
};

export const actions: Actions = {
	update_single_classification: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const transactionId = String(formData.get('transaction_id') ?? '').trim();
		const categoryId = String(formData.get('category_id') ?? '').trim() || null;
		const subcategoryId = categoryId ? String(formData.get('subcategory_id') ?? '').trim() || null : null;
		const ownerProfileId = String(formData.get('owner_profile_id') ?? '').trim() || null;
		const month = String(formData.get('month') ?? '').trim();
		const page = String(formData.get('page') ?? '').trim();

		if (!transactionId) {
			return fail(400, { success: false, message: 'Transação inválida' });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const [editableSet, { data: existing, error: loadError }] = await Promise.all([
			getEditableTransactionIds(supabase, user.id, [transactionId]),
			supabaseAdmin
				.from('transactions')
				.select('id, category_id, subcategory_id, owner_profile_id')
				.eq('household_id', householdId)
				.eq('id', transactionId)
				.single()
		]);

		if (loadError || !existing) {
			return fail(404, { success: false, message: 'Transação não encontrada' });
		}

		if (!editableSet.has(transactionId)) {
			return fail(403, { success: false, message: 'Sem permissão para editar essa transação' });
		}

		const patch = {
			category_id: categoryId,
			subcategory_id: subcategoryId,
			owner_profile_id: ownerProfileId,
			review_status: 'confirmed',
			updated_at: new Date().toISOString()
		};

		const relationError = await validateTransactionRelations(supabase, householdId, patch, user.id);
		if (relationError) {
			return fail(400, { success: false, message: relationError });
		}

		const changed =
			existing.category_id !== categoryId ||
			existing.subcategory_id !== subcategoryId ||
			existing.owner_profile_id !== ownerProfileId;

		if (changed) {
			const { error } = await supabaseAdmin
				.from('transactions')
				.update(patch)
				.eq('id', transactionId)
				.eq('household_id', householdId);

			if (error) return fail(500, { success: false, message: error.message });

			await learnFromTransactionAdjustment(supabaseAdmin, {
				householdId,
				userId: user.id,
				transactionId,
				categoryId,
				subcategoryId,
				ownerProfileId
			});
		}

		const params = new URLSearchParams();
		if (month) params.set('month', month);
		if (page && page !== '0') params.set('page', page);
		appendFilters(params, formData);
		const query = params.toString();
		redirect(303, `/app/transactions${query ? `?${query}` : ''}`);
	},

	confirm_single: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const transactionId = String(formData.get('transaction_id') ?? '').trim();
		if (!transactionId) return fail(400, { success: false, message: 'Transação inválida' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const editableSet = await getEditableTransactionIds(supabase, user.id, [transactionId]);
		if (!editableSet.has(transactionId)) {
			return fail(403, { success: false, message: 'Sem permissão para editar essa transação' });
		}

		const { error } = await supabaseAdmin
			.from('transactions')
			.update({
				review_status: 'confirmed',
				updated_at: new Date().toISOString()
			})
			.eq('id', transactionId)
			.eq('household_id', householdId);

		if (error) return fail(500, { success: false, message: error.message });
		return { success: true };
	},

	ignore_single: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const transactionId = String(formData.get('transaction_id') ?? '').trim();
		if (!transactionId) return fail(400, { success: false, message: 'Transação inválida' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const editableSet = await getEditableTransactionIds(supabase, user.id, [transactionId]);
		if (!editableSet.has(transactionId)) {
			return fail(403, { success: false, message: 'Sem permissão para editar essa transação' });
		}

		const { error } = await supabaseAdmin
			.from('transactions')
			.update({
				review_status: 'ignored',
				classification_method: 'manual',
				updated_at: new Date().toISOString()
			})
			.eq('id', transactionId)
			.eq('household_id', householdId);

		if (error) return fail(500, { success: false, message: error.message });
		return { success: true };
	},

	restore_single: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const transactionId = String(formData.get('transaction_id') ?? '').trim();
		if (!transactionId) return fail(400, { success: false, message: 'Transação inválida' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const editableSet = await getEditableTransactionIds(supabase, user.id, [transactionId]);
		if (!editableSet.has(transactionId)) {
			return fail(403, { success: false, message: 'Sem permissão para editar essa transação' });
		}

		const { error } = await supabaseAdmin
			.from('transactions')
			.update({
				review_status: 'needs_review',
				updated_at: new Date().toISOString()
			})
			.eq('id', transactionId)
			.eq('household_id', householdId);

		if (error) return fail(500, { success: false, message: error.message });
		return { success: true };
	},

	create_subcategory: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const transactionId = cleanName(formData.get('transaction_id'));
		const parentId = cleanName(formData.get('category_id'));
		const name = cleanName(formData.get('new_subcategory_name'));
		const ownerProfileId = cleanName(formData.get('owner_profile_id')) || null;
		if (!transactionId || !parentId || !name) {
			return fail(400, { success: false, message: 'Informe categoria e nome da subcategoria' });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const editableSet = await getEditableTransactionIds(supabase, user.id, [transactionId]);
		if (!editableSet.has(transactionId)) {
			return fail(403, { success: false, message: 'Sem permissão para editar essa transação' });
		}

		const visibleCategories = await loadCategoriesForUser(supabaseAdmin, householdId, user.id);
		const parent = visibleCategories.find((category) => category.id === parentId && !category.parent_id);
		if (!parent) return fail(400, { success: false, message: 'Categoria pai inválida' });

		const existing = visibleCategories.find(
			(category) =>
				category.parent_id === parentId &&
				category.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')
		);
		let subcategoryId: string | null = existing?.id ?? null;
		let message = existing ? 'Subcategoria já existia' : 'Subcategoria criada';

		if (!subcategoryId) {
			const { data: created, error } = await supabaseAdmin
				.from('categories')
				.insert({
					household_id: householdId,
					name,
					parent_id: parentId,
					created_by_user_id: user.id,
					is_default: false
				})
				.select('id')
				.single();

			if (error || !created) {
				return fail(500, { success: false, message: error?.message ?? 'Erro ao criar subcategoria' });
			}

			subcategoryId = created.id;
		}

		const patch = {
			category_id: parentId,
			subcategory_id: subcategoryId,
			owner_profile_id: ownerProfileId,
			review_status: 'confirmed',
			updated_at: new Date().toISOString()
		};

		const relationError = await validateTransactionRelations(supabase, householdId, patch, user.id);
		if (relationError) {
			return fail(400, { success: false, message: relationError });
		}

		const { error: updateError } = await supabaseAdmin
			.from('transactions')
			.update(patch)
			.eq('id', transactionId)
			.eq('household_id', householdId);

		if (updateError) return fail(500, { success: false, message: updateError.message });

		await learnFromTransactionAdjustment(supabaseAdmin, {
			householdId,
			userId: user.id,
			transactionId,
			categoryId: parentId,
			subcategoryId,
			ownerProfileId
		});

		return {
			success: true,
			message,
			createdSubcategoryId: subcategoryId,
			parentId,
			transactionId
		};
	},

	update_classification: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const transactionIds = formData.getAll('transaction_id').map((v) => String(v).trim());
		const categoryIds = formData.getAll('category_id').map((v) => String(v).trim() || null);
		const subcategoryIds = formData.getAll('subcategory_id').map((v) => String(v).trim() || null);
		const ownerProfileIds = formData.getAll('owner_profile_id').map((v) => String(v).trim() || null);

		if (
			transactionIds.length === 0 ||
			transactionIds.length !== categoryIds.length ||
			transactionIds.length !== subcategoryIds.length ||
			transactionIds.length !== ownerProfileIds.length
		) {
			return fail(400, { success: false, message: 'Dados incompletos' });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const [editableSet, { data: existingRows }] = await Promise.all([
			getEditableTransactionIds(supabase, user.id, transactionIds),
			supabaseAdmin
				.from('transactions')
				.select('id, category_id, subcategory_id, owner_profile_id')
				.eq('household_id', householdId)
				.in('id', transactionIds)
		]);

		const existingById = new Map((existingRows ?? []).map((row) => [row.id, row]));
		const now = new Date().toISOString();
		let updated = 0;

		for (let i = 0; i < transactionIds.length; i += 1) {
			const transactionId = transactionIds[i];
			if (!editableSet.has(transactionId)) {
				return fail(403, { success: false, message: 'Sem permissão para uma ou mais transações' });
			}

			const categoryId = categoryIds[i];
			const subcategoryId = categoryId ? subcategoryIds[i] : null;
			const ownerProfileId = ownerProfileIds[i];
			const existing = existingById.get(transactionId);
			if (!existing) {
				return fail(404, { success: false, message: 'Transação não encontrada' });
			}

			if (
				existing.category_id === categoryId &&
				existing.subcategory_id === subcategoryId &&
				existing.owner_profile_id === ownerProfileId
			) {
				continue;
			}

			const patch = {
				category_id: categoryId,
				subcategory_id: subcategoryId,
				owner_profile_id: ownerProfileId,
				review_status: 'confirmed',
				updated_at: now
			};

			const relationError = await validateTransactionRelations(supabase, householdId, patch, user.id);
			if (relationError) {
				return fail(400, { success: false, message: relationError });
			}

			const { error } = await supabaseAdmin
				.from('transactions')
				.update(patch)
				.eq('id', transactionId)
				.eq('household_id', householdId);

			if (error) return fail(500, { success: false, message: error.message });

			await learnFromTransactionAdjustment(supabaseAdmin, {
				householdId,
				userId: user.id,
				transactionId,
				categoryId,
				subcategoryId,
				ownerProfileId
			});
			updated += 1;
		}

		return { success: true, message: `${updated} transações atualizadas` };
	},

	delete_selected: async ({ request, url, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const transactionIds = Array.from(new Set(formData.getAll('transaction_id').map((v) => String(v).trim()).filter(Boolean)));
		const month = String(formData.get('month') ?? '').trim();
		const page = String(formData.get('page') ?? '').trim();
		if (transactionIds.length === 0) return fail(400, { success: false, message: 'Selecione ao menos uma transação' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const editableSet = await getEditableTransactionIds(supabase, user.id, transactionIds);
		if (editableSet.size !== transactionIds.length) {
			return fail(403, { success: false, message: 'Sem permissão para uma ou mais transações' });
		}

		const { error } = await supabaseAdmin
			.from('transactions')
			.delete()
			.eq('household_id', householdId)
			.in('id', transactionIds);
		if (error) return fail(500, { success: false, message: error.message });

		const params = new URLSearchParams();
		if (month) params.set('month', month);
		if (page && page !== '0') params.set('page', page);
		appendFilters(params, formData);
		const query = params.toString();
		redirect(303, `/app/transactions${query ? `?${query}` : url.search}`);
	},

	delete_month: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const referenceMonth = String(formData.get('reference_month') ?? '').trim();
		if (!/^\d{4}-\d{2}$/.test(referenceMonth)) {
			return fail(400, { success: false, message: 'Mês inválido' });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) return fail(400, { success: false, message: 'Usuário não pertence a um grupo' });

		const { data: rows, error: loadError } = await supabaseAdmin
			.from('transactions')
			.select('id')
			.eq('household_id', householdId)
			.eq('reference_month', referenceMonth);
		if (loadError) return fail(500, { success: false, message: loadError.message });

		const transactionIds = (rows ?? []).map((row) => row.id);
		if (transactionIds.length === 0) return fail(404, { success: false, message: 'Nenhuma transação nesse mês' });

		const editableSet = await getEditableTransactionIds(supabase, user.id, transactionIds);
		if (editableSet.size !== transactionIds.length) {
			return fail(403, { success: false, message: 'Sem permissão para apagar todas as transações desse mês' });
		}

		const { error } = await supabaseAdmin
			.from('transactions')
			.delete()
			.eq('household_id', householdId)
			.eq('reference_month', referenceMonth);
		if (error) return fail(500, { success: false, message: error.message });

		const params = new URLSearchParams();
		appendFilters(params, formData);
		const query = params.toString();
		redirect(303, `/app/transactions${query ? `?${query}` : ''}`);
	}
};
