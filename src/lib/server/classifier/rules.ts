import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

export interface RuleMatch {
	category_id: string | null;
	subcategory_id: string | null;
	owner_profile_id: string | null;
	confidence: number;
	reason_code: string;
}

export type ClassificationRule = Database['public']['Tables']['classification_rules']['Row'];

export async function loadActiveRules(
	supabase: SupabaseClient<Database>,
	householdId: string,
	userId?: string
): Promise<ClassificationRule[]> {
	let query = supabase
		.from('classification_rules')
		.select('*')
		.eq('household_id', householdId)
		.eq('active', true);

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
	const searchDesc = (cleanDescription ?? description ?? '').trim().toUpperCase();

	for (const rule of rules) {
		const pattern = rule.pattern.trim().toUpperCase();
		let matched = false;

		switch (rule.pattern_type) {
			case 'exact_merchant':
				matched = searchMerchant === pattern;
				break;
			case 'merchant_contains':
				matched = searchMerchant.includes(pattern);
				break;
			case 'description_contains':
				matched = searchDesc.includes(pattern);
				break;
			case 'regex':
				try {
					const re = new RegExp(rule.pattern, 'i');
					matched = re.test(merchant ?? '') || re.test(description ?? '');
				} catch {
					matched = false;
				}
				break;
		}

		if (matched) {
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
