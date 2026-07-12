import { describe, expect, it } from 'vitest';
import {
	canEditTransaction,
	canReadTransaction,
	getReadableTransactionIds,
	isHouseholdAdmin,
	updateTransactionForHousehold,
	validateTransactionRelations
} from './access';
import { deleteRuleForHousehold, updateRuleActiveForHousehold } from './rules';

type QueryResult = {
	data?: unknown;
	error?: { message: string } | null;
	count?: number | null;
};

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

describe('household transaction access', () => {
	it('recognizes an administrator and read/edit permissions', async () => {
		await expect(
			isHouseholdAdmin(
				supabaseForQueries([
					new QueryMock({ data: { user_id: 'user-a' }, error: null })
				]),
				'household-a',
				'user-a'
			)
		).resolves.toBe(true);

		await expect(
			canReadTransaction(
				supabaseForQueries([
					new QueryMock({ data: { id: 'access-a' }, error: null })
				]),
				'tx-a',
				'user-a'
			)
		).resolves.toBe(true);

		await expect(
			canEditTransaction(
				supabaseForQueries([
					new QueryMock({ data: { id: 'access-a' }, error: null })
				]),
				'tx-a',
				'user-a'
			)
		).resolves.toBe(true);
	});

	it('lists only readable transactions and returns an empty list on query failure', async () => {
		const query = new QueryMock({
			data: [{ transaction_id: 'tx-a' }, { transaction_id: 'tx-b' }],
			error: null
		});

		await expect(
			getReadableTransactionIds(supabaseForQueries([query]), 'user-a', {
				canEdit: true
			})
		).resolves.toEqual(['tx-a', 'tx-b']);
		expect(query.calls).toContainEqual({
			method: 'eq',
			args: ['can_edit', true]
		});

		await expect(
			getReadableTransactionIds(
				supabaseForQueries([
					new QueryMock({
						data: null,
						error: { message: 'database unavailable' }
					})
				]),
				'user-a'
			)
		).resolves.toEqual([]);
	});
});

describe('household scoped mutations', () => {
	it('scopes rule toggle by id and household', async () => {
		const query = new QueryMock();
		await updateRuleActiveForHousehold(
			supabaseForQueries([query]),
			'household-a',
			'rule-a',
			false
		);

		expect(query.calls).toContainEqual({
			method: 'eq',
			args: ['id', 'rule-a']
		});
		expect(query.calls).toContainEqual({
			method: 'eq',
			args: ['household_id', 'household-a']
		});
	});

	it('scopes rule delete by id and household', async () => {
		const query = new QueryMock();
		await deleteRuleForHousehold(
			supabaseForQueries([query]),
			'household-a',
			'rule-a'
		);

		expect(query.calls).toContainEqual({
			method: 'eq',
			args: ['id', 'rule-a']
		});
		expect(query.calls).toContainEqual({
			method: 'eq',
			args: ['household_id', 'household-a']
		});
	});

	it('scopes transaction update by id and household', async () => {
		const query = new QueryMock();
		await updateTransactionForHousehold(
			supabaseForQueries([query]),
			'tx-a',
			'household-a',
			{
				review_status: 'confirmed'
			}
		);

		expect(query.calls).toContainEqual({ method: 'eq', args: ['id', 'tx-a'] });
		expect(query.calls).toContainEqual({
			method: 'eq',
			args: ['household_id', 'household-a']
		});
	});
});

describe('validateTransactionRelations', () => {
	function categoryResult(
		parentId: string | null,
		createdByUserId: string | null = 'user-a'
	) {
		return new QueryMock({
			data: {
				id: 'category-a',
				parent_id: parentId,
				created_by_user_id: createdByUserId
			},
			error: null
		});
	}

	function foundResult() {
		return new QueryMock({ data: { id: 'found' }, error: null });
	}

	it('rejects category ids that are not found in the current household', async () => {
		const category = new QueryMock({ data: null, error: null });
		const error = await validateTransactionRelations(
			supabaseForQueries([category]),
			'household-a',
			{ category_id: 'category-from-household-b' },
			'user-a'
		);

		expect(category.calls).toContainEqual({
			method: 'eq',
			args: ['household_id', 'household-a']
		});
		expect(error).toBe('Categoria inválida para este grupo');
	});

	it('rejects parent categories and categories belonging to another user', async () => {
		await expect(
			validateTransactionRelations(
				supabaseForQueries([categoryResult('parent-a')]),
				'household-a',
				{ category_id: 'category-a' },
				'user-a'
			)
		).resolves.toBe('Categoria inválida para este grupo');

		await expect(
			validateTransactionRelations(
				supabaseForQueries([categoryResult(null, 'user-b')]),
				'household-a',
				{ category_id: 'category-a' },
				'user-a'
			)
		).resolves.toBe('Categoria pertence ao gabarito de outro usuário');
	});

	it('validates subcategory hierarchy and ownership', async () => {
		await expect(
			validateTransactionRelations(
				supabaseForQueries([categoryResult('category-a')]),
				'household-a',
				{ subcategory_id: 'subcategory-a' },
				'user-a'
			)
		).resolves.toBe('Selecione uma categoria antes da subcategoria');

		await expect(
			validateTransactionRelations(
				supabaseForQueries([
					categoryResult(null),
					categoryResult('category-b')
				]),
				'household-a',
				{ category_id: 'category-a', subcategory_id: 'subcategory-a' },
				'user-a'
			)
		).resolves.toBe('Subcategoria não pertence à categoria selecionada');

		await expect(
			validateTransactionRelations(
				supabaseForQueries([
					categoryResult(null),
					categoryResult('category-a', 'user-b')
				]),
				'household-a',
				{ category_id: 'category-a', subcategory_id: 'subcategory-a' },
				'user-a'
			)
		).resolves.toBe('Subcategoria pertence ao gabarito de outro usuário');
	});

	it('rejects profiles and payers outside the household', async () => {
		await expect(
			validateTransactionRelations(
				supabaseForQueries([new QueryMock({ data: null, error: null })]),
				'household-a',
				{ owner_profile_id: 'profile-a' },
				'user-a'
			)
		).resolves.toBe('Perfil financeiro inválido para este grupo');

		await expect(
			validateTransactionRelations(
				supabaseForQueries([new QueryMock({ data: null, error: null })]),
				'household-a',
				{ paid_by_user_id: 'user-b' },
				'user-a'
			)
		).resolves.toBe('Pagador inválido para este grupo');
	});

	it('accepts valid relations scoped to the household', async () => {
		const category = categoryResult(null);
		const subcategory = categoryResult('category-a');
		const profile = foundResult();
		const payer = foundResult();

		await expect(
			validateTransactionRelations(
				supabaseForQueries([category, subcategory, profile, payer]),
				'household-a',
				{
					category_id: 'category-a',
					subcategory_id: 'subcategory-a',
					owner_profile_id: 'profile-a',
					paid_by_user_id: 'user-a'
				},
				'user-a'
			)
		).resolves.toBeNull();

		for (const query of [category, subcategory, profile, payer]) {
			expect(query.calls).toContainEqual({
				method: 'eq',
				args: ['household_id', 'household-a']
			});
		}
	});
});
