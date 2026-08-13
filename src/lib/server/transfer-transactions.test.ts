import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from '../../routes/app/transactions/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getUserHouseholdId } from '$lib/server/household';

vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data: Record<string, unknown>) => ({
		status,
		...data
	}),
	redirect: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({
	getUserHouseholdId: vi.fn(),
	attachPayerProfiles: vi.fn()
}));
vi.mock('$lib/server/access', () => ({
	READABLE_ACCESS_EMBED: 'transaction_access!inner(user_id)',
	filterByReadableAccess: vi.fn(),
	validateTransactionRelations: vi.fn()
}));
vi.mock('$lib/server/learning', () => ({
	learnFromTransactionAdjustment: vi.fn()
}));
vi.mock('$lib/server/gabarito', () => ({ filterCategoriesForUser: vi.fn() }));
vi.mock('$lib/server/categories', () => ({
	loadCategoriesForUser: vi.fn(),
	loadUserCategoryExclusions: vi.fn()
}));

type QueryResult = { data?: unknown; error?: { message: string } | null };

class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];
	constructor(private readonly result: QueryResult) {}
	select(...args: unknown[]) {
		this.calls.push({ method: 'select', args });
		return this;
	}
	update(...args: unknown[]) {
		this.calls.push({ method: 'update', args });
		return this;
	}
	eq(...args: unknown[]) {
		this.calls.push({ method: 'eq', args });
		return this;
	}
	in(...args: unknown[]) {
		this.calls.push({ method: 'in', args });
		return this;
	}
	then(resolve: (value: QueryResult) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
}

function request(fields: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return { formData: async () => formData } as never;
}

function event(request: unknown, editableIds: string[] = ['tx-a']) {
	return {
		request,
		locals: {
			supabase: {
				from: () =>
					new QueryMock({
						data: editableIds.map((id) => ({ transaction_id: id })),
						error: null
					})
			},
			safeGetSession: async () => ({ user: { id: 'user-a' } })
		}
	} as never;
}

const mockedAdminFrom = vi.mocked(supabaseAdmin.from);

beforeEach(() => {
	mockedAdminFrom.mockReset();
	vi.mocked(getUserHouseholdId).mockReset();
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
});

describe('marking a transaction as a transfer', () => {
	it('sets the flag and scopes the write to the household', async () => {
		const update = new QueryMock({ data: null, error: null });
		mockedAdminFrom.mockReturnValue(update as never);

		const result = await actions.toggle_transfer(
			event(request({ transaction_id: 'tx-a', is_transfer: 'true' }))
		);

		expect(result).toMatchObject({ success: true });
		const patch = update.calls.find((call) => call.method === 'update')
			?.args[0] as { is_transfer: boolean };
		expect(patch.is_transfer).toBe(true);
		// Scoped by household as well as id, so a guessed id from another
		// household cannot be flipped.
		expect(update.calls).toContainEqual({
			method: 'eq',
			args: ['household_id', 'household-a']
		});
	});

	it('takes the mark back when asked', async () => {
		const update = new QueryMock({ data: null, error: null });
		mockedAdminFrom.mockReturnValue(update as never);

		await actions.toggle_transfer(
			event(request({ transaction_id: 'tx-a', is_transfer: 'false' }))
		);

		const patch = update.calls.find((call) => call.method === 'update')
			?.args[0] as { is_transfer: boolean };
		expect(patch.is_transfer).toBe(false);
	});

	// The flag decides whether money counts, so write access is required --
	// read access is not enough.
	it('refuses without edit permission and writes nothing', async () => {
		const result = await actions.toggle_transfer(
			event(request({ transaction_id: 'tx-a', is_transfer: 'true' }), [])
		);

		expect(result).toMatchObject({ status: 403 });
		expect(mockedAdminFrom).not.toHaveBeenCalled();
	});

	it('rejects unauthenticated callers before touching the database', async () => {
		const result = await actions.toggle_transfer({
			request: request({ transaction_id: 'tx-a', is_transfer: 'true' }),
			locals: {
				supabase: {} as never,
				safeGetSession: async () => ({ user: null })
			}
		} as never);

		expect(result).toMatchObject({ status: 401 });
		expect(mockedAdminFrom).not.toHaveBeenCalled();
	});

	it('rejects a missing transaction id', async () => {
		const result = await actions.toggle_transfer(
			event(request({ is_transfer: 'true' }))
		);

		expect(result).toMatchObject({ status: 400 });
		expect(mockedAdminFrom).not.toHaveBeenCalled();
	});
});
