import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { supabaseAdmin } from '$lib/server/supabase';
import { applyRules, loadActiveRules } from './rules';
import { callLlm } from '$lib/server/llm';
import { classificationResultSchema } from '$lib/schemas/classification';
import {
	buildGabaritoPromptSection,
	buildUserTaxonomyPromptSection,
	filterCategoriesForUser
} from '$lib/server/gabarito';
import { buildPersonalGabaritoPromptSection } from '$lib/server/learning';
import { loadUserCategoryExclusions } from '$lib/server/categories';

const CONFIDENCE_THRESHOLD = 0.7;
const LLM_BATCH_SIZE = 30;

type TxRow = {
	id: string;
	description: string;
	clean_description: string | null;
	merchant: string | null;
	amount: number;
	date: string;
	household_id: string;
};

type TxUpdate = Database['public']['Tables']['transactions']['Update'];
type LlmClassification = { id: string; needs_review: boolean; patch: TxUpdate };
type CategoryOption = { id: string; name: string; parent_id: string | null };

function normalizeClassificationName(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLocaleLowerCase('pt-BR');
}

function normalizeDescription(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLocaleLowerCase('pt-BR');
}

function isCardStatementPayment(tx: TxRow): boolean {
	if (Number(tx.amount) <= 0) return false;
	const text = normalizeDescription(`${tx.clean_description ?? tx.description} ${tx.merchant ?? ''}`);
	const hasPaymentWord = /\b(pagamento|pagto|pgto|liquidacao|liq)\b/.test(text);
	const hasStatementWord = /\b(fatura|cartao|cartao de credito|cc)\b/.test(text);
	return hasPaymentWord && hasStatementWord;
}

function deterministicClassification(tx: TxRow, rules: Awaited<ReturnType<typeof loadActiveRules>>) {
	if (isCardStatementPayment(tx)) {
		return {
			method: 'system', needs_review: false,
			patch: {
				category_id: null, subcategory_id: null, classification_method: 'system',
				classification_confidence: 1, review_status: 'ignored',
				classification_suggestion: {
					type: 'ignored', ignored_reason: 'card_statement_payment', reason_code: 'card_statement_payment'
				}
			} as TxUpdate
		};
	}
	const match = applyRules(rules, tx.merchant, tx.description, tx.clean_description);
	if (!match) return null;
	const needsReview = match.confidence < CONFIDENCE_THRESHOLD;
	return {
		method: 'rule', needs_review: needsReview,
		patch: {
			category_id: match.category_id, subcategory_id: match.subcategory_id,
			owner_profile_id: match.owner_profile_id, classification_method: 'rule',
			classification_confidence: match.confidence,
			review_status: needsReview ? 'needs_review' : 'confirmed'
		} as TxUpdate
	};
}

function buildTaxonomy(categories: CategoryOption[]) {
	const childrenByParent = new Map<string, CategoryOption[]>();
	for (const category of categories) {
		if (!category.parent_id) continue;
		const children = childrenByParent.get(category.parent_id) ?? [];
		children.push(category);
		childrenByParent.set(category.parent_id, children);
	}
	return categories.filter((category) => !category.parent_id).map((parent) => {
		const children = (childrenByParent.get(parent.id) ?? []).map((child) => child.name);
		return children.length > 0 ? `- ${parent.name}: ${children.join(', ')}` : `- ${parent.name}`;
	}).join('\n');
}

export async function classifyTransactions(
	supabase: SupabaseClient<Database>,
	householdId: string,
	transactionIds: string[],
	userId: string
): Promise<Array<{ id: string; method: string; needs_review: boolean }>> {
	if (transactionIds.length === 0) return [];

	const { data: transactions } = await supabase
		.from('transactions')
		.select('id, description, clean_description, merchant, amount, date, household_id')
		.in('id', transactionIds)
		.eq('household_id', householdId)
		.eq('review_status', 'needs_review');

	if (!transactions || transactions.length === 0) return [];

	const [{ data: categories }, rules, excludedCategoryIds] = await Promise.all([
		supabase
			.from('categories')
			.select('id, name, parent_id, created_by_user_id')
			.eq('household_id', householdId)
			.order('name'),
		loadActiveRules(supabase, householdId, userId),
		loadUserCategoryExclusions(supabase, householdId, userId)
	]);

	const results: Array<{ id: string; method: string; needs_review: boolean }> = [];
	const updates: Array<{ id: string; patch: TxUpdate }> = [];
	const uncategorizedTxs: TxRow[] = [];

	for (const tx of transactions) {
		const classified = deterministicClassification(tx, rules);
		if (classified) {
			updates.push({ id: tx.id, patch: classified.patch });
			results.push({ id: tx.id, method: classified.method, needs_review: classified.needs_review });
		} else {
			uncategorizedTxs.push(tx);
		}
	}

	if (uncategorizedTxs.length > 0) {
		const cats = filterCategoriesForUser(categories ?? [], userId, excludedCategoryIds);
		const taxonomy = buildTaxonomy(cats);

		for (let i = 0; i < uncategorizedTxs.length; i += LLM_BATCH_SIZE) {
			const chunk = uncategorizedTxs.slice(i, i + LLM_BATCH_SIZE);
			const chunkResults = await classifyChunkWithLlm(supabase, householdId, userId, chunk, taxonomy, cats);
			for (const r of chunkResults) {
				updates.push({ id: r.id, patch: r.patch });
				results.push({ id: r.id, method: 'llm', needs_review: r.needs_review });
			}
		}
	}

	await runUpdates(householdId, updates);
	return results;
}

async function classifyChunkWithLlm(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId: string,
	chunk: TxRow[],
	taxonomy: string,
	categories: CategoryOption[]
): Promise<LlmClassification[]> {
	const gabaritoSection = buildGabaritoPromptSection(chunk);
	const userTaxonomySection = buildUserTaxonomyPromptSection(categories, userId);
	const personalGabaritoSection = await buildPersonalGabaritoPromptSection(
		supabase,
		householdId,
		userId,
		chunk
	);

	const systemPrompt = `You are a transaction classifier for a Brazilian household expense tracker. Respond with JSON only.

## Available categories and subcategories (you MUST use these EXACT names):
${taxonomy}

${userTaxonomySection}

${personalGabaritoSection}

${gabaritoSection}

## Rules:
- Use the EXACT category and subcategory names listed above.
- "subcategory" is optional. Use it only when one of the listed subcategories clearly applies.
- DO NOT guess an owner — never return owner_profile. Owner assignment is the user's responsibility.
- First, infer from the existing gabarito sections, personal examples, active rules, and available taxonomy.
- If the gabarito is not enough, reason from the merchant/description using general Brazilian financial context and likely merchant type, then choose the closest listed category.
- Classify primarily from the description/merchant. In Brazilian credit-card exports, purchases may appear as positive amounts.
- Treat explicit card payments, refunds, chargebacks, estornos, "volta", and IOF reversals as credits/adjustments when the description says so.
- Prefer a broad category with needs_review=true and confidence between 0.45 and 0.69 when it is plausible.
- Return category=null only when the description is truly impossible to classify into any listed broad category.`;

	const txDescriptions = chunk
		.map(
			(tx) =>
				`- id: ${tx.id}\n  description: ${tx.clean_description ?? tx.description}\n  merchant: ${tx.merchant ?? 'N/A'}\n  amount: ${tx.amount}\n  date: ${tx.date}`
		)
		.join('\n\n');

	const userPrompt = `Classify these transactions and return JSON in the shape { "results": [ ... ] } where each element of results has: id, category (string or null), subcategory (string or null), confidence (0-1), needs_review (boolean), reason_code (string). Do not include owner_profile.

Transactions:
${txDescriptions}`;

	try {
		const llmRes = await callLlm({
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			max_tokens: 4000,
			json_mode: true
		});

		const rawContent = llmRes.choices[0]?.message?.content ?? '{}';
		const cleaned = rawContent.replace(/```json\s*|\s*```/g, '').trim();
		let parsed: unknown;
		try {
			parsed = JSON.parse(cleaned);
		} catch {
			parsed = {};
		}
		return processLlmBatch(extractResultsArray(parsed), chunk, categories, rawContent);
	} catch (e) {
		console.error('[classifier] LLM classification failed', e);
		return chunk.map((tx) => ({
			id: tx.id,
			needs_review: true,
			patch: {
				classification_method: 'llm',
				classification_confidence: 0,
				review_status: 'needs_review',
				classification_suggestion: { type: 'error', error: 'llm_error', message: String(e) }
			}
		}));
	}
}

function invalidLlmClassification(id: string, rawContent: string): LlmClassification {
	return {
		id,
		needs_review: true,
		patch: {
			classification_method: 'llm',
			classification_confidence: 0,
			review_status: 'needs_review',
			classification_suggestion: { type: 'error', error: 'invalid_response', raw: rawContent }
		}
	};
}

function missingLlmClassification(id: string): LlmClassification {
	return {
		id,
		needs_review: true,
		patch: {
			classification_method: 'llm',
			classification_confidence: 0,
			review_status: 'needs_review',
			classification_suggestion: { type: 'error', error: 'missing_in_response' }
		}
	};
}

function suggestionNeedsReview(
	suggestion: { category?: string | null; subcategory?: string | null; confidence: number; needs_review: boolean },
	categoryId: string | null,
	subcategoryId: string | null
) {
	return suggestion.needs_review || suggestion.confidence < CONFIDENCE_THRESHOLD ||
		(!!suggestion.category && !categoryId) || (!!suggestion.subcategory && !!categoryId && !subcategoryId);
}

function mapLlmClassification(id: string, item: unknown, categories: CategoryOption[], rawContent: string): LlmClassification {
	const validated = classificationResultSchema.safeParse(item);
	if (!validated.success) return invalidLlmClassification(id, rawContent);

	const suggestion = validated.data;
	const categoryName = normalizeClassificationName(suggestion.category);
	const subcategoryName = normalizeClassificationName(suggestion.subcategory);
	const category = categoryName
		? categories.find((candidate) => normalizeClassificationName(candidate.name) === categoryName && !candidate.parent_id)
		: null;
	const categoryId = category?.id ?? null;
	const subcategoryId = subcategoryName && categoryId
		? categories.find((candidate) =>
			normalizeClassificationName(candidate.name) === subcategoryName && candidate.parent_id === categoryId)?.id ?? null
		: null;
	const needsReview = suggestionNeedsReview(suggestion, categoryId, subcategoryId);

	return {
		id,
		needs_review: needsReview,
		patch: {
			category_id: categoryId,
			subcategory_id: subcategoryId,
			classification_method: 'llm',
			classification_confidence: suggestion.confidence,
			review_status: needsReview ? 'needs_review' : 'confirmed',
			classification_suggestion: suggestion
		}
	};
}

function processLlmBatch(
	batch: unknown[],
	chunk: TxRow[],
	categories: CategoryOption[],
	rawContent: string
): LlmClassification[] {
	const out: LlmClassification[] = [];
	const seen = new Set<string>();
	const allowedIds = new Set(chunk.map((tx) => tx.id));
	for (const item of batch) {
		const id = (item as Record<string, string>)?.id;
		if (!id || !allowedIds.has(id) || seen.has(id)) continue;
		seen.add(id);
		out.push(mapLlmClassification(id, item, categories, rawContent));
	}
	for (const tx of chunk) {
		if (!seen.has(tx.id)) out.push(missingLlmClassification(tx.id));
	}
	return out;
}

function extractResultsArray(parsed: unknown): unknown[] {
	if (Array.isArray(parsed)) return parsed;
	if (parsed && typeof parsed === 'object') {
		const obj = parsed as Record<string, unknown>;
		if (Array.isArray(obj.results)) return obj.results;
		if (Array.isArray(obj.classifications)) return obj.classifications;
		if (Array.isArray(obj.transactions)) return obj.transactions;
		if (typeof obj.id === 'string') return [obj];
	}
	return [];
}

// The classification RPC is SECURITY DEFINER and only executable by the
// service role, so it must go through the admin client. The transaction ids in
// `updates` were loaded with the caller's RLS-enforced client and the RPC
// re-checks household_id on every row, so the household scope still holds.
async function runUpdates(
	householdId: string,
	updates: Array<{ id: string; patch: TxUpdate }>
): Promise<void> {
	const payload = updates.map((u) => ({
		id: u.id,
		household_id: householdId,
		category_id: u.patch.category_id ?? null,
		subcategory_id: u.patch.subcategory_id ?? null,
		owner_profile_id: u.patch.owner_profile_id ?? null,
		classification_method: u.patch.classification_method ?? 'unknown',
		classification_confidence: u.patch.classification_confidence ?? null,
		review_status: u.patch.review_status ?? 'needs_review',
		classification_suggestion: u.patch.classification_suggestion ?? null
	}));
	const { data, error } = await supabaseAdmin.rpc('apply_transaction_classification_updates', {
		updates: payload
	});
	if (error) {
		console.error('[classifier] batch classification update failed', error);
		throw error;
	}
	if (Number(data ?? 0) !== payload.length) {
		throw new Error(`Batch classification update mismatch: ${data ?? 0}/${payload.length}`);
	}
}
