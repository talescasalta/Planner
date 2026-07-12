import { describe, expect, it } from 'vitest';
import {
	confidenceForReinforcement,
	learnFromTransactionAdjustment
} from './learning';

type QueryResult = { data?: unknown; error?: { message: string } | null };

class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];

	constructor(
		private readonly result: QueryResult = { data: null, error: null }
	) {}

	select(...args: unknown[]) {
		this.calls.push({ method: 'select', args });
		return this;
	}

	update(...args: unknown[]) {
		this.calls.push({ method: 'update', args });
		return this;
	}

	insert(...args: unknown[]) {
		this.calls.push({ method: 'insert', args });
		return this;
	}

	eq(...args: unknown[]) {
		this.calls.push({ method: 'eq', args });
		return this;
	}

	maybeSingle() {
		return Promise.resolve(this.result);
	}

	then(resolve: (value: QueryResult) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
}

function supabaseForQueries(queries: QueryMock[]) {
	const tables: string[] = [];
	return {
		tables,
		client: {
			from: (table: string) => {
				tables.push(table);
				const query = queries.shift();
				if (!query) throw new Error(`Unexpected query for ${table}`);
				return query;
			}
		} as never
	};
}

const learningInput = {
	householdId: 'household-a',
	userId: 'user-a',
	transactionId: 'transaction-a',
	categoryId: 'category-a',
	subcategoryId: null,
	ownerProfileId: null
};

const transaction = {
	id: 'transaction-a',
	description: 'Loja Exemplo 2/3',
	clean_description: null,
	merchant: null,
	household_id: 'household-a'
};

describe('confidenceForReinforcement', () => {
	it('keeps the first correction below auto-confirmation and raises after reinforcement', () => {
		expect(confidenceForReinforcement(1)).toBe(0.65);
		expect(confidenceForReinforcement(2)).toBe(0.72);
		expect(confidenceForReinforcement(3)).toBe(0.85);
		expect(confidenceForReinforcement(10)).toBe(0.85);
	});
});

describe('learnFromTransactionAdjustment', () => {
	it('does not create a rule without a category', async () => {
		const supabase = supabaseForQueries([]);

		await learnFromTransactionAdjustment(supabase.client, {
			...learningInput,
			categoryId: null
		});

		expect(supabase.tables).toEqual([]);
	});

	it('does not learn from a transaction that is no longer available in the household', async () => {
		const supabase = supabaseForQueries([
			new QueryMock({ data: null, error: null })
		]);

		await learnFromTransactionAdjustment(supabase.client, learningInput);

		expect(supabase.tables).toEqual(['transactions']);
	});

	it('creates a reusable description rule and removes installment markers', async () => {
		const transactionQuery = new QueryMock({ data: transaction, error: null });
		const existingRuleQuery = new QueryMock({ data: null, error: null });
		const insertQuery = new QueryMock();
		const supabase = supabaseForQueries([
			transactionQuery,
			existingRuleQuery,
			insertQuery
		]);

		await learnFromTransactionAdjustment(supabase.client, learningInput);

		expect(supabase.tables).toEqual([
			'transactions',
			'classification_rules',
			'classification_rules'
		]);
		expect(insertQuery.calls).toContainEqual({
			method: 'insert',
			args: [
				{
					household_id: 'household-a',
					created_by_user_id: 'user-a',
					pattern: 'LOJA EXEMPLO',
					pattern_type: 'description_contains',
					category_id: 'category-a',
					subcategory_id: null,
					owner_profile_id: null,
					active: true,
					reinforcement_count: 1,
					confidence: 0.65
				}
			]
		});
	});

	it('reinforces the same adjustment instead of creating a duplicate rule', async () => {
		const updateQuery = new QueryMock();
		const supabase = supabaseForQueries([
			new QueryMock({
				data: { ...transaction, merchant: 'Mercado Central' },
				error: null
			}),
			new QueryMock({
				data: {
					id: 'rule-a',
					reinforcement_count: 1,
					category_id: 'category-a',
					subcategory_id: null
				},
				error: null
			}),
			updateQuery
		]);

		await learnFromTransactionAdjustment(supabase.client, learningInput);

		expect(updateQuery.calls).toContainEqual({
			method: 'update',
			args: [
				{
					category_id: 'category-a',
					subcategory_id: null,
					owner_profile_id: null,
					active: true,
					reinforcement_count: 2,
					confidence: 0.72
				}
			]
		});
	});

	it('does not overwrite a conflicting rule after a passive confirmation', async () => {
		const supabase = supabaseForQueries([
			new QueryMock({
				data: { ...transaction, merchant: 'Mercado Central' },
				error: null
			}),
			new QueryMock({
				data: {
					id: 'rule-a',
					reinforcement_count: 3,
					category_id: 'category-b',
					subcategory_id: null
				},
				error: null
			})
		]);

		await learnFromTransactionAdjustment(
			supabase.client,
			learningInput,
			'confirmation'
		);

		expect(supabase.tables).toEqual(['transactions', 'classification_rules']);
	});

	it('reinforces a matching rule after a passive confirmation without changing its classification', async () => {
		const updateQuery = new QueryMock();
		const supabase = supabaseForQueries([
			new QueryMock({
				data: { ...transaction, merchant: 'Mercado Central' },
				error: null
			}),
			new QueryMock({
				data: {
					id: 'rule-a',
					reinforcement_count: 2,
					category_id: 'category-a',
					subcategory_id: null
				},
				error: null
			}),
			updateQuery
		]);

		await learnFromTransactionAdjustment(
			supabase.client,
			learningInput,
			'confirmation'
		);

		expect(updateQuery.calls).toContainEqual({
			method: 'update',
			args: [{ active: true, reinforcement_count: 3, confidence: 0.85 }]
		});
	});
});
