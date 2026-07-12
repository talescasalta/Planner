import { describe, expect, it } from 'vitest';
import { applyRules, type ClassificationRule } from './rules';

function rule(
	overrides: Partial<ClassificationRule> &
		Pick<ClassificationRule, 'pattern' | 'pattern_type' | 'category_id'>
): ClassificationRule {
	return {
		id: crypto.randomUUID(),
		household_id: 'household-a',
		pattern: overrides.pattern,
		pattern_type: overrides.pattern_type,
		category_id: overrides.category_id,
		subcategory_id: overrides.subcategory_id ?? null,
		owner_profile_id: overrides.owner_profile_id ?? null,
		confidence: overrides.confidence ?? 0.9,
		created_by_user_id: 'user-a',
		active: true,
		created_at: new Date().toISOString(),
		reinforcement_count: 1
	} as ClassificationRule;
}

describe('applyRules', () => {
	it('prioritizes exact merchant over contains rules', () => {
		const match = applyRules(
			[
				rule({
					pattern: 'UBER',
					pattern_type: 'merchant_contains',
					category_id: 'generic'
				}),
				rule({
					pattern: 'UBER TRIP',
					pattern_type: 'exact_merchant',
					category_id: 'exact'
				})
			],
			'UBER TRIP',
			'UBER TRIP HELP',
			'UBER TRIP HELP'
		);

		expect(match?.category_id).toBe('exact');
	});

	it('prioritizes regex over contains rules', () => {
		const match = applyRules(
			[
				rule({
					pattern: 'MERCADO',
					pattern_type: 'description_contains',
					category_id: 'contains'
				}),
				rule({
					pattern: '^MERCADO .+ SA$',
					pattern_type: 'regex',
					category_id: 'regex'
				})
			],
			null,
			'MERCADO CENTRAL SA',
			'MERCADO CENTRAL SA'
		);

		expect(match?.category_id).toBe('regex');
	});

	it('prioritizes exact merchant over regex rules', () => {
		const match = applyRules(
			[
				rule({
					pattern: '^UBER.*$',
					pattern_type: 'regex',
					category_id: 'regex'
				}),
				rule({
					pattern: 'UBER TRIP',
					pattern_type: 'exact_merchant',
					category_id: 'exact'
				})
			],
			'UBER TRIP',
			'UBER TRIP HELP',
			'UBER TRIP HELP'
		);

		expect(match?.category_id).toBe('exact');
	});

	it('uses the longest contains pattern across merchant and description rules', () => {
		const match = applyRules(
			[
				rule({
					pattern: 'IFOOD',
					pattern_type: 'merchant_contains',
					category_id: 'short'
				}),
				rule({
					pattern: 'IFOOD RESTAURANTE',
					pattern_type: 'description_contains',
					category_id: 'long'
				})
			],
			'IFOOD',
			'IFOOD RESTAURANTE ABC',
			'IFOOD RESTAURANTE ABC'
		);

		expect(match?.category_id).toBe('long');
	});
});
