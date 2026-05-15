import { describe, expect, it } from 'vitest';
import { updateTransactionForHousehold, validateTransactionRelations } from './access';
import { deleteRuleForHousehold, updateRuleActiveForHousehold } from './rules';

type QueryResult = { data?: unknown; error?: { message: string } | null; count?: number | null };

class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];
	result: QueryResult;

	constructor(result: QueryResult = { data: null, error: null }) {
		this.result = result;
	}

	select(...args: unknown[]) {
		this.calls.push({ method: 'select', args });
		return this;
	}

	update(...args: unknown[]) {
		this.calls.push({ method: 'update', args });
		return this;
	}

	delete(...args: unknown[]) {
		this.calls.push({ method: 'delete', args });
		return this;
	}

	eq(...args: unknown[]) {
		this.calls.push({ method: 'eq', args });
		return this;
	}

	maybeSingle() {
		return Promise.resolve(this.result);
	}

	then(resolve: (value: QueryResult) => void) {
		resolve(this.result);
	}
}

function supabaseForQueries(queries: QueryMock[]) {
	return {
		from: () => {
			const query = queries.shift();
			if (!query) throw new Error('Unexpected query');
			return query;
		}
	} as never;
}

describe('household scoped mutations', () => {
	it('scopes rule toggle by id and household', async () => {
		const query = new QueryMock();
		await updateRuleActiveForHousehold(supabaseForQueries([query]), 'household-a', 'rule-a', false);

		expect(query.calls).toContainEqual({ method: 'eq', args: ['id', 'rule-a'] });
		expect(query.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
	});

	it('scopes rule delete by id and household', async () => {
		const query = new QueryMock();
		await deleteRuleForHousehold(supabaseForQueries([query]), 'household-a', 'rule-a');

		expect(query.calls).toContainEqual({ method: 'eq', args: ['id', 'rule-a'] });
		expect(query.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
	});

	it('scopes transaction update by id and household', async () => {
		const query = new QueryMock();
		await updateTransactionForHousehold(supabaseForQueries([query]), 'tx-a', 'household-a', {
			review_status: 'confirmed'
		});

		expect(query.calls).toContainEqual({ method: 'eq', args: ['id', 'tx-a'] });
		expect(query.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
	});
});

describe('validateTransactionRelations', () => {
	it('rejects category ids that are not found in the current household', async () => {
		const category = new QueryMock({ data: null, error: null });
		const error = await validateTransactionRelations(
			supabaseForQueries([category]),
			'household-a',
			{ category_id: 'category-from-household-b' },
			'user-a'
		);

		expect(category.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
		expect(error).toBe('Categoria inválida para este grupo');
	});
});
