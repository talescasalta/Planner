import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from '../../routes/app/categories/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getUserHouseholdId } from '$lib/server/household';
import { loadCategoriesForUser } from '$lib/server/categories';

vi.mock('@sveltejs/kit', () => ({ fail: (status: number, data: Record<string, unknown>) => ({ status, ...data }) }));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({ getUserHouseholdId: vi.fn() }));
vi.mock('$lib/server/categories', () => ({
	loadCategorySettingsForUser: vi.fn(),
	loadCategoriesForUser: vi.fn()
}));

type QueryResult = { data?: unknown; error?: { message: string } | null; count?: number | null };

class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];
	constructor(private readonly result: QueryResult = { data: null, error: null }) {}
	select(...args: unknown[]) { this.calls.push({ method: 'select', args }); return this; }
	insert(...args: unknown[]) { this.calls.push({ method: 'insert', args }); return this; }
	upsert(...args: unknown[]) { this.calls.push({ method: 'upsert', args }); return this; }
	delete(...args: unknown[]) { this.calls.push({ method: 'delete', args }); return this; }
	eq(...args: unknown[]) { this.calls.push({ method: 'eq', args }); return this; }
	maybeSingle() { return Promise.resolve(this.result); }
	then(resolve: (value: QueryResult) => unknown) { return Promise.resolve(resolve(this.result)); }
}

function requestWith(fields: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return { formData: async () => formData } as never;
}

function event(request: unknown, authenticated = true) {
	return {
		request,
		locals: {
			supabase: {} as never,
			safeGetSession: async () => ({ user: authenticated ? { id: 'user-a' } : null })
		}
	} as never;
}

const mockedFrom = vi.mocked(supabaseAdmin.from);

beforeEach(() => {
	mockedFrom.mockReset();
	vi.mocked(getUserHouseholdId).mockReset();
	vi.mocked(loadCategoriesForUser).mockReset();
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(loadCategoriesForUser).mockResolvedValue([]);
});

describe('category actions', () => {
	it('rejects unauthenticated writes before touching Supabase', async () => {
		const result = await actions.create_category(event(requestWith({ name: 'Viagens' }), false));

		expect(result).toMatchObject({ status: 401 });
		expect(mockedFrom).not.toHaveBeenCalled();
	});

	it('surfaces category insert failures with household-scoped payload', async () => {
		const insertion = new QueryMock({ error: { message: 'insert failed' } });
		mockedFrom.mockReturnValue(insertion as never);

		const result = await actions.create_category(event(requestWith({ name: '  Viagens  ' })));

		expect(result).toMatchObject({ status: 500, message: 'insert failed' });
		expect(insertion.calls).toContainEqual({
			method: 'insert',
			args: [{ household_id: 'household-a', name: 'Viagens', parent_id: null, created_by_user_id: 'user-a', is_default: false }]
		});
	});

	it('hides a shared/default category for only the current user', async () => {
		const category = new QueryMock({ data: { id: 'category-a', parent_id: null, created_by_user_id: null }, error: null });
		const exclusion = new QueryMock({ error: null });
		const queries = [category, exclusion];
		mockedFrom.mockImplementation(() => queries.shift() as never);

		await expect(actions.delete(event(requestWith({ category_id: 'category-a' })))).resolves.toMatchObject({ success: true });

		expect(category.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
		expect(exclusion.calls).toContainEqual({
			method: 'upsert',
			args: [
				{ household_id: 'household-a', user_id: 'user-a', category_id: 'category-a' },
				{ onConflict: 'household_id,user_id,category_id' }
			]
		});
	});

	it('does not delete a personal category while it is referenced', async () => {
		const category = new QueryMock({ data: { id: 'category-a', parent_id: null, created_by_user_id: 'user-a' }, error: null });
		const usage = [1, 0, 0, 0, 0].map((count) => new QueryMock({ count, error: null }));
		const queries = [category, ...usage];
		mockedFrom.mockImplementation(() => queries.shift() as never);

		const result = await actions.delete(event(requestWith({ category_id: 'category-a' })));

		expect(result).toMatchObject({ status: 409 });
		expect(mockedFrom).toHaveBeenCalledTimes(6);
		expect(usage.every((query) => query.calls.every((call) => call.method !== 'delete'))).toBe(true);
	});

	it('surfaces persistence errors when restoring a hidden category', async () => {
		const deletion = new QueryMock({ error: { message: 'restore failed' } });
		mockedFrom.mockReturnValue(deletion as never);

		const result = await actions.restore(event(requestWith({ category_id: 'category-a' })));

		expect(result).toMatchObject({ status: 500, message: 'restore failed' });
		expect(deletion.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
		expect(deletion.calls).toContainEqual({ method: 'eq', args: ['user_id', 'user-a'] });
	});
});
