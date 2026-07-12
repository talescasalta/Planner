import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

export interface RuleMatch {
	category_id: string | null;
	subcategory_id: string | null;
	owner_profile_id: string | null;
	confidence: number;
	reason_code: string;
}

export type ClassificationRule =
	Database['public']['Tables']['classification_rules']['Row'];

export async function loadActiveRules(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId?: string
): Promise<ClassificationRule[]> {
	let query = supabase
		.from('classification_rules')
		.select('*')
		.eq('household_id', householdId)
		.eq('active', true)
		.not('category_id', 'is', null);

	if (userId) {
		query = query.eq('created_by_user_id', userId);
	}

	const { data } = await query.order('created_at', { ascending: true });
	return data ?? [];
}

export function applyRules(
	rules: ClassificationRule[],
	merchant: string | null,
	description: string,
	cleanDescription: string | null
): RuleMatch | null {
	if (rules.length === 0) return null;

	const searchMerchant = (merchant ?? '').trim().toUpperCase();
	const searchDesc = (cleanDescription ?? description ?? '')
		.trim()
		.toUpperCase();

	const sortedRules = [...rules].sort(compareRulesBySpecificity);
	for (const rule of sortedRules) {
		if (ruleMatches(rule, searchMerchant, searchDesc, merchant, description)) {
			return {
				category_id: rule.category_id,
				subcategory_id: rule.subcategory_id ?? null,
				owner_profile_id: rule.owner_profile_id,
				confidence: rule.confidence,
				reason_code: `rule_${rule.pattern_type}`
			};
		}
	}

	return null;
}

function ruleMatches(
	rule: ClassificationRule,
	searchMerchant: string,
	searchDescription: string,
	merchant: string | null,
	description: string
) {
	const pattern = rule.pattern.trim().toUpperCase();
	switch (rule.pattern_type) {
		case 'exact_merchant':
			return searchMerchant === pattern;
		case 'merchant_contains':
			return searchMerchant.includes(pattern);
		case 'description_contains':
			return searchDescription.includes(pattern);
		case 'regex':
			try {
				const regex = new RegExp(rule.pattern, 'i');
				return regex.test(merchant ?? '') || regex.test(description);
			} catch {
				return false;
			}
		default:
			return false;
	}
}

function patternLength(rule: ClassificationRule): number {
	return rule.pattern.trim().length;
}

function ruleRank(rule: ClassificationRule): number {
	switch (rule.pattern_type) {
		case 'exact_merchant':
			return 0;
		case 'regex':
			return 1;
		case 'merchant_contains':
			return 2;
		case 'description_contains':
			return 2;
		default:
			return 4;
	}
}

export function compareRulesBySpecificity(
	a: ClassificationRule,
	b: ClassificationRule
): number {
	const rankDiff = ruleRank(a) - ruleRank(b);
	if (rankDiff !== 0) return rankDiff;
	return patternLength(b) - patternLength(a);
}
