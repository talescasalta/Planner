import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
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
const DB_PARALLELISM = 10;

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

function normalizeClassificationName(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.trim()
		.replace(/\s+/g, ' ')
		.toLocaleLowerCase('pt-BR');
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
		const ruleMatch = applyRules(rules, tx.merchant, tx.description, tx.clean_description);
		if (ruleMatch) {
			const needsReview = ruleMatch.confidence < CONFIDENCE_THRESHOLD;
			updates.push({
				id: tx.id,
				patch: {
					category_id: ruleMatch.category_id,
					subcategory_id: ruleMatch.subcategory_id,
					owner_profile_id: ruleMatch.owner_profile_id,
					classification_method: 'rule',
					classification_confidence: ruleMatch.confidence,
					review_status: needsReview ? 'needs_review' : 'confirmed'
				}
			});
			results.push({ id: tx.id, method: 'rule', needs_review: needsReview });
			continue;
		}
		uncategorizedTxs.push(tx);
	}

	if (uncategorizedTxs.length > 0) {
		const cats = filterCategoriesForUser(categories ?? [], userId, excludedCategoryIds);
		const parents = cats.filter((c) => !c.parent_id);
		const childrenByParent = new Map<string, typeof cats>();
		for (const c of cats) {
			if (!c.parent_id) continue;
			const arr = childrenByParent.get(c.parent_id) ?? [];
			arr.push(c);
			childrenByParent.set(c.parent_id, arr);
		}

		const taxonomy = parents
			.map((p) => {
				const subs = (childrenByParent.get(p.id) ?? []).map((s) => s.name);
				return subs.length > 0 ? `- ${p.name}: ${subs.join(', ')}` : `- ${p.name}`;
			})
			.join('\n');

		for (let i = 0; i < uncategorizedTxs.length; i += LLM_BATCH_SIZE) {
			const chunk = uncategorizedTxs.slice(i, i + LLM_BATCH_SIZE);
			const chunkResults = await classifyChunkWithLlm(supabase, householdId, userId, chunk, taxonomy, cats);
			for (const r of chunkResults) {
				updates.push({ id: r.id, patch: r.patch });
				results.push({ id: r.id, method: 'llm', needs_review: r.needs_review });
			}
		}
	}

	await runUpdates(supabase, updates);
	return results;
}

async function classifyChunkWithLlm(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId: string,
	chunk: TxRow[],
	taxonomy: string,
	categories: Array<{ id: string; name: string; parent_id: string | null }>
): Promise<Array<{ id: string; needs_review: boolean; patch: TxUpdate }>> {
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
- Negative amount = expense. Positive amount = income/credit.
- If you cannot confidently pick a category, return needs_review=true and confidence below 0.5; you may set category=null.`;

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
		const batch = extractResultsArray(parsed);

		const out: Array<{ id: string; needs_review: boolean; patch: TxUpdate }> = [];
		const seen = new Set<string>();

		for (const item of batch) {
			const txId = (item as Record<string, string>)?.id;
			if (!txId) continue;
			seen.add(txId);

			const validated = classificationResultSchema.safeParse(item);
			if (!validated.success) {
				out.push({
					id: txId,
					needs_review: true,
					patch: {
						classification_method: 'llm',
						classification_confidence: 0,
						review_status: 'needs_review',
						classification_suggestion: { error: 'invalid_response', raw: rawContent }
					}
				});
				continue;
			}

			const suggestion = validated.data;
			const suggestedCategory = normalizeClassificationName(suggestion.category);
			const suggestedSubcategory = normalizeClassificationName(suggestion.subcategory);
			const categoryRow = suggestedCategory
				? categories.find((c) => normalizeClassificationName(c.name) === suggestedCategory && !c.parent_id) ?? null
				: null;
			const categoryId = categoryRow?.id ?? null;
			const subcategoryId =
				suggestedSubcategory && categoryId
					? categories.find(
							(c) => normalizeClassificationName(c.name) === suggestedSubcategory && c.parent_id === categoryId
						)?.id ?? null
					: null;
			const needsReview =
				suggestion.needs_review ||
				suggestion.confidence < CONFIDENCE_THRESHOLD ||
				(!!suggestion.category && !categoryId) ||
				(!!suggestion.subcategory && !!categoryId && !subcategoryId);

			out.push({
				id: txId,
				needs_review: needsReview,
				patch: {
					category_id: categoryId,
					subcategory_id: subcategoryId,
					classification_method: 'llm',
					classification_confidence: suggestion.confidence,
					review_status: needsReview ? 'needs_review' : 'confirmed',
					classification_suggestion: suggestion
				}
			});
		}

		for (const tx of chunk) {
			if (seen.has(tx.id)) continue;
			out.push({
				id: tx.id,
				needs_review: true,
				patch: {
					classification_method: 'llm',
					classification_confidence: 0,
					review_status: 'needs_review',
					classification_suggestion: { error: 'missing_in_response' }
				}
			});
		}

		return out;
	} catch (e) {
		return chunk.map((tx) => ({
			id: tx.id,
			needs_review: true,
			patch: {
				classification_method: 'llm',
				classification_confidence: 0,
				review_status: 'needs_review',
				classification_suggestion: { error: 'llm_error', message: String(e) }
			}
		}));
	}
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

async function runUpdates(
	supabase: SupabaseClient<Database>,
	updates: Array<{ id: string; patch: TxUpdate }>
): Promise<void> {
	for (let i = 0; i < updates.length; i += DB_PARALLELISM) {
		const slice = updates.slice(i, i + DB_PARALLELISM);
		await Promise.all(
			slice.map((u) => supabase.from('transactions').update(u.patch).eq('id', u.id))
		);
	}
}
