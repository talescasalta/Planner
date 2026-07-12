import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions as ruleActions } from '../../routes/app/rules/+page.server';
import { actions as reviewActions } from '../../routes/app/review/+page.server';
import { getUserHouseholdId } from '$lib/server/household';
import {
	canEditTransaction,
	updateTransactionForHousehold,
	validateTransactionRelations
} from '$lib/server/access';
import {
	deleteRuleForHousehold,
	updateRuleActiveForHousehold
} from '$lib/server/rules';
import { learnFromTransactionAdjustment } from '$lib/server/learning';

vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data: Record<string, unknown>) => ({ status, ...data })
}));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({
	getUserHouseholdId: vi.fn(),
	attachPayerProfiles: vi.fn()
}));
vi.mock('$lib/server/access', () => ({
	canEditTransaction: vi.fn(),
	getReadableTransactionIds: vi.fn(),
	updateTransactionForHousehold: vi.fn(),
	validateTransactionRelations: vi.fn()
}));
vi.mock('$lib/server/rules', () => ({
	deleteRuleForHousehold: vi.fn(),
	updateRuleActiveForHousehold: vi.fn()
}));
vi.mock('$lib/server/learning', () => ({
	learnFromTransactionAdjustment: vi.fn()
}));
vi.mock('$lib/server/categories', () => ({
	loadCategoriesForUser: vi.fn(),
	loadUserCategoryExclusions: vi.fn()
}));
vi.mock('$lib/server/gabarito', () => ({ filterCategoriesForUser: vi.fn() }));

type QueryResult = { data?: unknown; error?: { message: string } | null };
class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];
	constructor(
		private readonly result: QueryResult = { data: null, error: null }
	) {}
	insert(...args: unknown[]) {
		this.calls.push({ method: 'insert', args });
		return this;
	}
	then(resolve: (value: QueryResult) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
}

function requestWith(fields: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return { formData: async () => formData } as never;
}

function event(request: unknown, supabase: unknown = {}) {
	return {
		request,
		locals: {
			supabase,
			safeGetSession: async () => ({ user: { id: 'user-a' } })
		}
	} as never;
}

beforeEach(() => {
	vi.mocked(getUserHouseholdId).mockReset();
	vi.mocked(validateTransactionRelations).mockReset();
	vi.mocked(canEditTransaction).mockReset();
	vi.mocked(updateTransactionForHousehold).mockReset();
	vi.mocked(updateRuleActiveForHousehold).mockReset();
	vi.mocked(deleteRuleForHousehold).mockReset();
	vi.mocked(learnFromTransactionAdjustment).mockReset();
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(validateTransactionRelations).mockResolvedValue(null);
	vi.mocked(canEditTransaction).mockResolvedValue(true);
	vi.mocked(updateTransactionForHousehold).mockResolvedValue({
		error: null
	} as never);
	vi.mocked(updateRuleActiveForHousehold).mockResolvedValue({
		error: null
	} as never);
	vi.mocked(deleteRuleForHousehold).mockResolvedValue({ error: null } as never);
});

describe('rule actions', () => {
	it('rejects invalid cross-household category relations before inserting', async () => {
		vi.mocked(validateTransactionRelations).mockResolvedValue(
			'Categoria inválida para este grupo'
		);
		const from = vi.fn();

		const result = await ruleActions.create(
			event(
				requestWith({
					pattern: 'MERCADO',
					pattern_type: 'description_contains',
					category_id: 'foreign-category'
				}),
				{ from }
			)
		);

		expect(result).toMatchObject({
			status: 400,
			message: 'Categoria inválida para este grupo'
		});
		expect(from).not.toHaveBeenCalled();
	});

	it('surfaces rule persistence failures and sends the scoped rule payload', async () => {
		const insertion = new QueryMock({
			error: { message: 'rule insert failed' }
		});
		const from = vi.fn(() => insertion);

		const result = await ruleActions.create(
			event(
				requestWith({
					pattern: 'MERCADO',
					pattern_type: 'description_contains',
					category_id: 'category-a',
					confidence: '0.8'
				}),
				{ from }
			)
		);

		expect(result).toMatchObject({
			status: 500,
			message: 'rule insert failed'
		});
		expect(insertion.calls[0]).toEqual({
			method: 'insert',
			args: [
				expect.objectContaining({
					household_id: 'household-a',
					created_by_user_id: 'user-a',
					category_id: 'category-a',
					active: true
				})
			]
		});
	});

	it('propagates scoped toggle persistence failures', async () => {
		vi.mocked(updateRuleActiveForHousehold).mockResolvedValue({
			error: { message: 'toggle failed' }
		} as never);

		const result = await ruleActions.toggle(
			event(requestWith({ rule_id: 'rule-a', active: 'false' }))
		);

		expect(result).toMatchObject({ status: 500, message: 'toggle failed' });
		expect(updateRuleActiveForHousehold).toHaveBeenCalledWith(
			expect.anything(),
			'household-a',
			'rule-a',
			false
		);
	});
});

describe('review action', () => {
	const fields = {
		transaction_id: 'tx-a',
		category_id: 'category-a',
		subcategory_id: 'subcategory-a',
		owner_profile_id: 'profile-a'
	};

	it('rejects users without edit access before validation or persistence', async () => {
		vi.mocked(canEditTransaction).mockResolvedValue(false);

		const result = await reviewActions.default(event(requestWith(fields)));

		expect(result).toMatchObject({ status: 403 });
		expect(validateTransactionRelations).not.toHaveBeenCalled();
		expect(updateTransactionForHousehold).not.toHaveBeenCalled();
	});

	it('does not persist an invalid relation', async () => {
		vi.mocked(validateTransactionRelations).mockResolvedValue(
			'Perfil financeiro inválido para este grupo'
		);

		const result = await reviewActions.default(event(requestWith(fields)));

		expect(result).toMatchObject({
			status: 400,
			message: 'Perfil financeiro inválido para este grupo'
		});
		expect(updateTransactionForHousehold).not.toHaveBeenCalled();
	});

	it('surfaces update failures and never learns from an unpersisted adjustment', async () => {
		vi.mocked(updateTransactionForHousehold).mockResolvedValue({
			error: { message: 'update failed' }
		} as never);

		const result = await reviewActions.default(event(requestWith(fields)));

		expect(result).toMatchObject({ status: 500, message: 'update failed' });
		expect(learnFromTransactionAdjustment).not.toHaveBeenCalled();
	});

	it('learns only after a successful household-scoped update', async () => {
		await expect(
			reviewActions.default(event(requestWith(fields)))
		).resolves.toMatchObject({ success: true });

		expect(updateTransactionForHousehold).toHaveBeenCalledWith(
			expect.anything(),
			'tx-a',
			'household-a',
			expect.objectContaining({ review_status: 'confirmed' })
		);
		expect(learnFromTransactionAdjustment).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				householdId: 'household-a',
				userId: 'user-a',
				transactionId: 'tx-a'
			})
		);
	});
});
