import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions as newTransactionActions } from '../../routes/app/transactions/new/+page.server';
import { actions as transactionActions } from '../../routes/app/transactions/[id]/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getHouseholdMembers, getUserHouseholdId } from '$lib/server/household';
import {
	canEditTransaction,
	updateTransactionForHousehold,
	validateTransactionRelations
} from '$lib/server/access';
import { learnFromTransactionAdjustment } from '$lib/server/learning';

vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data: Record<string, unknown>) => ({ status, ...data }),
	redirect: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({
	getHouseholdMembers: vi.fn(), getUserHouseholdId: vi.fn(), attachPayerProfiles: vi.fn()
}));
vi.mock('$lib/server/access', () => ({
	canEditTransaction: vi.fn(), canReadTransaction: vi.fn(), updateTransactionForHousehold: vi.fn(),
	validateTransactionRelations: vi.fn()
}));
vi.mock('$lib/server/learning', () => ({ learnFromTransactionAdjustment: vi.fn() }));
vi.mock('$lib/server/categories', () => ({ loadCategoriesForUser: vi.fn() }));

type QueryResult = { data?: unknown; error?: { message: string } | null };
class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];
	constructor(private readonly result: QueryResult = { data: null, error: null }) {}
	select(...args: unknown[]) { this.calls.push({ method: 'select', args }); return this; }
	insert(...args: unknown[]) { this.calls.push({ method: 'insert', args }); return this; }
	delete(...args: unknown[]) { this.calls.push({ method: 'delete', args }); return this; }
	eq(...args: unknown[]) { this.calls.push({ method: 'eq', args }); return this; }
	maybeSingle() { return Promise.resolve(this.result); }
	then(resolve: (value: QueryResult) => unknown) { return Promise.resolve(resolve(this.result)); }
}

function draftRequest() {
	const formData = new FormData();
	formData.set('rows[0].date', '2026-07-10');
	formData.set('rows[0].description', 'Mercado');
	formData.set('rows[0].amount', '-100');
	return { formData: async () => formData } as never;
}

function updateRequest() {
	const formData = new FormData();
	formData.set('description', 'Mercado atualizado');
	formData.set('amount', '-120');
	return { formData: async () => formData } as never;
}

function event(request: unknown, supabase: unknown = {}) {
	return {
		params: { id: 'tx-a' },
		request,
		locals: {
			supabase,
			safeGetSession: async () => ({ user: { id: 'user-a' } })
		}
	} as never;
}

const mockedAdminFrom = vi.mocked(supabaseAdmin.from);

beforeEach(() => {
	mockedAdminFrom.mockReset();
	vi.mocked(getUserHouseholdId).mockReset();
	vi.mocked(getHouseholdMembers).mockReset();
	vi.mocked(canEditTransaction).mockReset();
	vi.mocked(validateTransactionRelations).mockReset();
	vi.mocked(updateTransactionForHousehold).mockReset();
	vi.mocked(learnFromTransactionAdjustment).mockReset();
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(getHouseholdMembers).mockResolvedValue(['user-a']);
	vi.mocked(canEditTransaction).mockResolvedValue(true);
	vi.mocked(validateTransactionRelations).mockResolvedValue(null);
	vi.mocked(updateTransactionForHousehold).mockResolvedValue({ error: null } as never);
});

describe('new transaction action', () => {
	it('stops before inserting when a row references an invalid household relation', async () => {
		vi.mocked(validateTransactionRelations).mockResolvedValue('Pagador inválido para este grupo');
		const from = vi.fn();

		const result = await newTransactionActions.default(event(draftRequest(), { from }));

		expect(result).toMatchObject({ status: 400, message: 'Algumas linhas precisam de ajuste antes do registro' });
		expect(from).not.toHaveBeenCalled();
	});

	it('surfaces transaction insert failures without granting access or learning', async () => {
		const transactionInsert = new QueryMock({ data: null, error: { message: 'transaction insert failed' } });
		const profiles = new QueryMock({ data: [], error: null });
		const from = vi.fn((table: string) => table === 'transactions' ? transactionInsert : profiles);

		const result = await newTransactionActions.default(event(draftRequest(), { from }));

		expect(result).toMatchObject({ status: 500, message: 'transaction insert failed' });
		expect(from).not.toHaveBeenCalledWith('transaction_access');
		expect(learnFromTransactionAdjustment).not.toHaveBeenCalled();
	});

	it('surfaces access persistence failures and never learns from the incomplete write', async () => {
		const transactionInsert = new QueryMock({
			data: [{ id: 'tx-a', owner_profile_id: null, paid_by_user_id: null, category_id: null, subcategory_id: null }],
			error: null
		});
		const profiles = new QueryMock({ data: [], error: null });
		const accessInsert = new QueryMock({ error: { message: 'access insert failed' } });
		const from = vi.fn((table: string) => {
			if (table === 'transactions') return transactionInsert;
			if (table === 'financial_profiles') return profiles;
			return accessInsert;
		});

		const result = await newTransactionActions.default(event(draftRequest(), { from }));

		expect(result).toMatchObject({ status: 500, message: 'access insert failed' });
		expect(accessInsert.calls).toContainEqual({
			method: 'insert', args: [[{ transaction_id: 'tx-a', user_id: 'user-a', can_read: true, can_edit: true }]]
		});
		expect(learnFromTransactionAdjustment).not.toHaveBeenCalled();
	});
});

describe('transaction detail actions', () => {
	it('rejects updates without can_edit before relation checks', async () => {
		vi.mocked(canEditTransaction).mockResolvedValue(false);

		const result = await transactionActions.default(event(updateRequest()));

		expect(result).toMatchObject({ status: 403 });
		expect(validateTransactionRelations).not.toHaveBeenCalled();
		expect(updateTransactionForHousehold).not.toHaveBeenCalled();
	});

	it('surfaces update failures and does not learn unpersisted changes', async () => {
		vi.mocked(updateTransactionForHousehold).mockResolvedValue({ error: { message: 'detail update failed' } } as never);

		const result = await transactionActions.default(event(updateRequest()));

		expect(result).toMatchObject({ status: 500, message: 'detail update failed' });
		expect(updateTransactionForHousehold).toHaveBeenCalledWith(
			expect.anything(), 'tx-a', 'household-a', expect.objectContaining({ review_status: 'confirmed' })
		);
		expect(learnFromTransactionAdjustment).not.toHaveBeenCalled();
	});

	it('scopes deletes to the household and propagates persistence failures', async () => {
		const lookup = new QueryMock({ data: { reference_month: '2026-07' }, error: null });
		const deletion = new QueryMock({ error: { message: 'delete failed' } });
		const queries = [lookup, deletion];
		mockedAdminFrom.mockImplementation(() => queries.shift() as never);

		const result = await transactionActions.delete(event(updateRequest()));

		expect(result).toMatchObject({ status: 500, message: 'delete failed' });
		expect(deletion.calls).toContainEqual({ method: 'eq', args: ['id', 'tx-a'] });
		expect(deletion.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
	});
});
