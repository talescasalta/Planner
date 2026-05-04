import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

type PatternType = 'merchant_contains' | 'description_contains';

type TransactionForLearning = {
	id: string;
	description: string;
	clean_description: string | null;
	merchant: string | null;
	household_id: string;
};

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

	const description = normalizePattern(tx.clean_description ?? tx.description ?? '');
	if (description) return { pattern: description, patternType: 'description_contains' };

	return null;
}

export async function learnFromTransactionAdjustment(
	supabase: SupabaseClient<Database>,
	input: ClassificationLearningInput
): Promise<void> {
	const { data: tx } = await supabase
		.from('transactions')
		.select('id, description, clean_description, merchant, household_id')
		.eq('id', input.transactionId)
		.eq('household_id', input.householdId)
		.maybeSingle();

	if (!tx) return;

	const chosen = choosePattern(tx);
	if (!chosen) return;

	const patch = {
		category_id: input.categoryId,
		subcategory_id: input.subcategoryId,
		owner_profile_id: input.ownerProfileId,
		confidence: 0.98,
		active: true
	};

	const { data: existing } = await supabase
		.from('classification_rules')
		.select('id')
		.eq('household_id', input.householdId)
		.eq('created_by_user_id', input.userId)
		.eq('pattern_type', chosen.patternType)
		.eq('pattern', chosen.pattern)
		.maybeSingle();

	if (existing?.id) {
		await supabase.from('classification_rules').update(patch).eq('id', existing.id);
		return;
	}

	await supabase.from('classification_rules').insert({
		household_id: input.householdId,
		created_by_user_id: input.userId,
		pattern: chosen.pattern,
		pattern_type: chosen.patternType,
		...patch
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
