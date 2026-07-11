import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { parseInstallment, stripInstallmentMarker } from './csv-parser';

type PatternType = 'merchant_contains' | 'description_contains';

type TransactionForLearning = {
	id: string;
	description: string;
	clean_description: string | null;
	merchant: string | null;
	household_id: string;
};

export function confidenceForReinforcement(count: number): number {
	if (count <= 1) return 0.65;
	if (count === 2) return 0.72;
	return 0.85;
}

export type ClassificationLearningInput = {
	householdId: string;
	userId: string;
	transactionId: string;
	categoryId: string | null;
	subcategoryId: string | null;
	ownerProfileId: string | null;
};

function normalizePattern(value: string): string {
	return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function choosePattern(tx: TransactionForLearning): { pattern: string; patternType: PatternType } | null {
	const merchant = normalizePattern(tx.merchant ?? '');
	if (merchant) return { pattern: merchant, patternType: 'merchant_contains' };

	// Installment markers ("3/5") change every month; strip them so the rule
	// learned from one installment matches the next ones via `contains`. Only
	// strip when it really is an installment — parseInstallment validates
	// k<=n and total<=72, so date/ratio endings ("ESTACIONAMENTO 24/7") keep
	// their suffix instead of becoming an over-broad pattern.
	const raw = normalizePattern(tx.clean_description ?? tx.description ?? '');
	const description = parseInstallment(raw) ? stripInstallmentMarker(raw) : raw;
	if (description) return { pattern: description, patternType: 'description_contains' };

	return null;
}

// 'adjustment' (default): the user actively re-classified — the new choice
// overwrites the rule, and a contradiction resets its confidence.
// 'confirmation': the user only endorsed what was already there — reinforce a
// matching rule or create a missing one, but never overwrite or downgrade an
// existing rule that disagrees (a low-friction ✓ must not destroy history).
export type LearningMode = 'adjustment' | 'confirmation';

type ExistingRule = {
	id: string;
	reinforcement_count: number | null;
	category_id: string | null;
	subcategory_id: string | null;
};

async function updateExistingRule(
	supabase: SupabaseClient<Database>,
	input: ClassificationLearningInput,
	mode: LearningMode,
	existing: ExistingRule,
	basePatch: { category_id: string; subcategory_id: string | null; owner_profile_id: string | null; active: boolean }
) {
	const sameClassification = existing.category_id === input.categoryId &&
		(existing.subcategory_id ?? null) === (input.subcategoryId ?? null);
	if (mode === 'confirmation' && !sameClassification) return;
	const reinforcementCount = sameClassification
		? Math.max(1, Number(existing.reinforcement_count ?? 1)) + 1
		: 1;
	const patch = mode === 'confirmation'
		? { active: true, reinforcement_count: reinforcementCount, confidence: confidenceForReinforcement(reinforcementCount) }
		: { ...basePatch, reinforcement_count: reinforcementCount, confidence: confidenceForReinforcement(reinforcementCount) };
	await supabase.from('classification_rules').update(patch)
		.eq('id', existing.id)
		.eq('household_id', input.householdId)
		.eq('created_by_user_id', input.userId);
}

export async function learnFromTransactionAdjustment(
	supabase: SupabaseClient<Database>,
	input: ClassificationLearningInput,
	mode: LearningMode = 'adjustment'
): Promise<void> {
	if (!input.categoryId) return;

	const { data: tx } = await supabase
		.from('transactions')
		.select('id, description, clean_description, merchant, household_id')
		.eq('id', input.transactionId)
		.eq('household_id', input.householdId)
		.maybeSingle();

	if (!tx) return;

	const chosen = choosePattern(tx);
	if (!chosen) return;

	const basePatch = {
		category_id: input.categoryId,
		subcategory_id: input.subcategoryId,
		owner_profile_id: input.ownerProfileId,
		active: true
	};

	const { data: existing } = await supabase
		.from('classification_rules')
		.select('id, reinforcement_count, category_id, subcategory_id')
		.eq('household_id', input.householdId)
		.eq('created_by_user_id', input.userId)
		.eq('pattern_type', chosen.patternType)
		.eq('pattern', chosen.pattern)
		.maybeSingle();

	if (existing?.id) {
		await updateExistingRule(supabase, input, mode, existing, basePatch);
		return;
	}

	const reinforcementCount = 1;
	await supabase.from('classification_rules').insert({
		household_id: input.householdId,
		created_by_user_id: input.userId,
		pattern: chosen.pattern,
		pattern_type: chosen.patternType,
		...basePatch,
		reinforcement_count: reinforcementCount,
		confidence: confidenceForReinforcement(reinforcementCount)
	});
}

export async function buildPersonalGabaritoPromptSection(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId: string,
	transactions: Array<{ description: string; clean_description: string | null; merchant: string | null }>
): Promise<string> {
	const { data: rules } = await supabase
		.from('classification_rules')
		.select('pattern, pattern_type, category_id, subcategory_id, owner_profile_id, created_at')
		.eq('household_id', householdId)
		.eq('created_by_user_id', userId)
		.eq('active', true)
		.not('category_id', 'is', null)
		.order('created_at', { ascending: false })
		.limit(100);

	const activeRules = rules ?? [];
	if (activeRules.length === 0) return '';

	const categoryIds = Array.from(
		new Set(activeRules.flatMap((r) => [r.category_id, r.subcategory_id]).filter((id): id is string => !!id))
	);
	const profileIds = Array.from(
		new Set(activeRules.map((r) => r.owner_profile_id).filter((id): id is string => !!id))
	);

	const [{ data: categories }, { data: profiles }] = await Promise.all([
		categoryIds.length
			? supabase.from('categories').select('id, name').in('id', categoryIds)
			: Promise.resolve({ data: [] }),
		profileIds.length
			? supabase.from('financial_profiles').select('id, name').in('id', profileIds)
			: Promise.resolve({ data: [] })
	]);

	const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.name]));
	const profileNameById = new Map((profiles ?? []).map((p) => [p.id, p.name]));
	const transactionNeedles = transactions.flatMap((tx) => [
		normalizePattern(tx.merchant ?? ''),
		normalizePattern(tx.clean_description ?? tx.description ?? '')
	]);

	const relevant = activeRules.filter((rule) =>
		transactionNeedles.some((needle) => needle && (needle.includes(rule.pattern) || rule.pattern.includes(needle)))
	);
	const examples = (relevant.length > 0 ? relevant : activeRules).slice(0, 40);

	const lines = examples.map((rule) => {
		const category = rule.category_id ? categoryNameById.get(rule.category_id) ?? 'sem categoria' : 'sem categoria';
		const subcategory = rule.subcategory_id
			? categoryNameById.get(rule.subcategory_id) ?? 'sem subcategoria'
			: 'sem subcategoria';
		const owner = rule.owner_profile_id ? profileNameById.get(rule.owner_profile_id) ?? 'sem atribuição' : 'sem atribuição';
		return `- padrão "${rule.pattern}" → categoria: "${category}", subcategoria: "${subcategory}", atribuição: "${owner}"`;
	});

	return `## Preferências pessoais do usuário

Use estes exemplos como prioridade sobre o gabarito geral quando a transação for similar.

${lines.join('\n')}`;
}
