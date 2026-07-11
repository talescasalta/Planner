import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from '../../routes/app/transactions/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getUserHouseholdId } from '$lib/server/household';
import { validateTransactionRelations } from '$lib/server/access';

vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data: Record<string, unknown>) => ({ status, ...data }),
	redirect: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({ getUserHouseholdId: vi.fn(), attachPayerProfiles: vi.fn() }));
vi.mock('$lib/server/access', () => ({ getReadableTransactionIds: vi.fn(), validateTransactionRelations: vi.fn() }));
vi.mock('$lib/server/learning', () => ({ learnFromTransactionAdjustment: vi.fn() }));
vi.mock('$lib/server/gabarito', () => ({ filterCategoriesForUser: vi.fn() }));
vi.mock('$lib/server/categories', () => ({ loadCategoriesForUser: vi.fn(), loadUserCategoryExclusions: vi.fn() }));

type QueryResult = { data?: unknown; error?: { message: string } | null };

class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];

	constructor(private readonly result: QueryResult) {}

	select(...args: unknown[]) { this.calls.push({ method: 'select', args }); return this; }
	update(...args: unknown[]) { this.calls.push({ method: 'update', args }); return this; }
	delete(...args: unknown[]) { this.calls.push({ method: 'delete', args }); return this; }
	eq(...args: unknown[]) { this.calls.push({ method: 'eq', args }); return this; }
	in(...args: unknown[]) { this.calls.push({ method: 'in', args }); return this; }
	then(resolve: (value: QueryResult) => unknown) { return Promise.resolve(resolve(this.result)); }
}

function requestForIds(ids: string[]) {
	const formData = new FormData();
	for (const id of ids) formData.append('transaction_id', id);
	formData.set('month', '2026-05');
	return { formData: async () => formData } as never;
}

const mockedAdminFrom = vi.mocked(supabaseAdmin.from);

beforeEach(() => {
	mockedAdminFrom.mockReset();
	vi.mocked(getUserHouseholdId).mockReset();
	vi.mocked(validateTransactionRelations).mockReset();
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(validateTransactionRelations).mockResolvedValue(null);
});

describe('transaction delete action', () => {
	it('deletes only the selected editable transactions in the current household', async () => {
		const access = new QueryMock({ data: [{ transaction_id: 'tx-a' }, { transaction_id: 'tx-b' }], error: null });
		const deletion = new QueryMock({ data: null, error: null });
		mockedAdminFrom.mockReturnValue(deletion as never);

		await actions.delete_selected({
			request: requestForIds(['tx-a', 'tx-b', 'tx-a']),
			url: new URL('https://planner.test/app/transactions'),
			locals: {
				supabase: { from: () => access } as never,
				safeGetSession: async () => ({ user: { id: 'user-a' } })
			}
		} as never);

		expect(deletion.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
		expect(deletion.calls).toContainEqual({ method: 'in', args: ['id', ['tx-a', 'tx-b']] });
	});

	it('refuses deletion when any selected transaction is not editable', async () => {
		const access = new QueryMock({ data: [{ transaction_id: 'tx-a' }], error: null });

		const result = await actions.delete_selected({
			request: requestForIds(['tx-a', 'tx-b']),
			url: new URL('https://planner.test/app/transactions'),
			locals: {
				supabase: { from: () => access } as never,
				safeGetSession: async () => ({ user: { id: 'user-a' } })
			}
		} as never);

		expect(result).toMatchObject({ status: 403 });
		expect(mockedAdminFrom).not.toHaveBeenCalled();
	});

	it('applies a bulk category patch only to editable rows in the household', async () => {
		const formData = new FormData();
		formData.append('transaction_id', 'tx-a');
		formData.set('category_id', 'category-a');
		formData.set('subcategory_id', 'subcategory-a');
		formData.set('owner_profile_id', '__keep__');
		const access = new QueryMock({ data: [{ transaction_id: 'tx-a' }], error: null });
		const existing = new QueryMock({
			data: [{ id: 'tx-a', category_id: null, subcategory_id: null, owner_profile_id: 'profile-a' }],
			error: null
		});
		const update = new QueryMock({ data: null, error: null });
		const adminQueries = [existing, update];
		mockedAdminFrom.mockImplementation(() => {
			const query = adminQueries.shift();
			if (!query) throw new Error('Unexpected admin query');
			return query as never;
		});

		await expect(
			actions.bulk_apply_classification({
				request: { formData: async () => formData } as never,
				locals: {
					supabase: { from: () => access } as never,
					safeGetSession: async () => ({ user: { id: 'user-a' } })
				}
			} as never)
		).resolves.toMatchObject({ success: true, message: '1 transações atualizadas' });

		expect(update.calls).toContainEqual({
			method: 'update',
			args: [
				expect.objectContaining({
					category_id: 'category-a',
					subcategory_id: 'subcategory-a',
					review_status: 'confirmed'
				})
			]
		});
		expect(update.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
	});
});
