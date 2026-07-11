import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from '../../routes/app/imports/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getHouseholdMembers, getUserHouseholdId } from '$lib/server/household';
import { isHouseholdAdmin } from '$lib/server/access';
import { resolveImportMapping } from '$lib/server/import-mapping';
import { buildImportDedupKey, detectMapping } from '$lib/server/csv-parser';
import { classifyTransactions } from '$lib/server/classifier';

vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data: Record<string, unknown>) => ({ status, ...data }),
	redirect: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({ getUserHouseholdId: vi.fn(), getHouseholdMembers: vi.fn() }));
vi.mock('$lib/server/classifier', () => ({ classifyTransactions: vi.fn() }));
vi.mock('$lib/server/access', () => ({ isHouseholdAdmin: vi.fn() }));
vi.mock('$lib/server/import-mapping', () => ({ resolveImportMapping: vi.fn() }));
vi.mock('$lib/server/csv-parser', () => ({ buildImportDedupKey: vi.fn(), detectMapping: vi.fn() }));
vi.mock('$lib/server/import-extract', () => ({
	detectImageMimeType: vi.fn(),
	extractRowsFromImage: vi.fn(),
	extractRowsFromText: vi.fn()
}));

type QueryResult = { data?: unknown; error?: { message: string } | null; count?: number | null };

class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];

	constructor(private readonly result: QueryResult = { data: null, error: null }) {}

	insert(...args: unknown[]) { this.calls.push({ method: 'insert', args }); return this; }
	upsert(...args: unknown[]) { this.calls.push({ method: 'upsert', args }); return this; }
	update(...args: unknown[]) { this.calls.push({ method: 'update', args }); return this; }
	select(...args: unknown[]) { this.calls.push({ method: 'select', args }); return this; }
	single() { return Promise.resolve(this.result); }
	eq(...args: unknown[]) { this.calls.push({ method: 'eq', args }); return this; }
	gte(...args: unknown[]) { this.calls.push({ method: 'gte', args }); return this; }
	lte(...args: unknown[]) { this.calls.push({ method: 'lte', args }); return this; }
	in(...args: unknown[]) { this.calls.push({ method: 'in', args }); return this; }
	then(resolve: (value: QueryResult) => unknown) { return Promise.resolve(resolve(this.result)); }
}

function requestWithImport() {
	const formData = new FormData();
	formData.set('reference_month', '2026-05');
	formData.set('pasted_text', 'date,title,amount\n2026-05-01,Mercado,10');
	return { formData: async () => formData } as never;
}

const mockedAdminFrom = vi.mocked(supabaseAdmin.from);

beforeEach(() => {
	mockedAdminFrom.mockReset();
	vi.mocked(getUserHouseholdId).mockReset();
	vi.mocked(getHouseholdMembers).mockReset();
	vi.mocked(isHouseholdAdmin).mockReset();
	vi.mocked(resolveImportMapping).mockReset();
	vi.mocked(buildImportDedupKey).mockReset();
	vi.mocked(detectMapping).mockReset();
	vi.mocked(classifyTransactions).mockReset();
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(getHouseholdMembers).mockResolvedValue(['user-a']);
	vi.mocked(isHouseholdAdmin).mockResolvedValue(true);
	vi.mocked(detectMapping).mockReturnValue({} as never);
	vi.mocked(buildImportDedupKey).mockReturnValue('dedup-a');
	vi.mocked(resolveImportMapping).mockResolvedValue({
		rows: [{ date: '2026-05-01', description: 'Mercado', clean_description: 'MERCADO', amount: -10, currency: 'BRL' }],
		sourceType: 'bank_account',
		mappingSource: 'deterministic',
		confidence: 1,
		notes: undefined
	} as never);
	vi.mocked(classifyTransactions).mockResolvedValue([]);
});

describe('import confirmation', () => {
	it('inserts only new household rows, grants access, verifies persistence and classifies them', async () => {
		const existingKeys = new QueryMock({ data: [], error: null });
		const importRecord = new QueryMock({ data: { id: 'import-a' }, error: null });
		const insertedTransactions = new QueryMock({
			data: [{ id: 'tx-a', amount: -10, date: '2026-05-01', description: 'Mercado', clean_description: 'MERCADO' }],
			error: null
		});
		const accessInsert = new QueryMock({ data: null, error: null });
		const persisted = new QueryMock({ data: null, count: 1, error: null });
		const completedImport = new QueryMock({ data: null, error: null });
		const adminQueries = [importRecord, insertedTransactions, accessInsert, persisted, completedImport];
		mockedAdminFrom.mockImplementation(() => {
			const query = adminQueries.shift();
			if (!query) throw new Error('Unexpected admin query');
			return query as never;
		});
		const userSupabase = {
			from: () => existingKeys
		} as never;

		await actions.confirm({
			request: requestWithImport(),
			locals: { supabase: userSupabase, safeGetSession: async () => ({ user: { id: 'user-a' } }) }
		} as never);

		expect(insertedTransactions.calls).toContainEqual({
			method: 'upsert',
			args: [
				[
					expect.objectContaining({
						household_id: 'household-a',
						import_dedup_key: 'dedup-a',
						review_status: 'needs_review',
						created_by_user_id: 'user-a'
					})
				],
				{ onConflict: 'household_id,reference_month,import_dedup_key', ignoreDuplicates: true }
			]
		});
		expect(accessInsert.calls).toContainEqual({
			method: 'insert',
			args: [[{ transaction_id: 'tx-a', user_id: 'user-a', can_read: true, can_edit: true }]]
		});
		expect(vi.mocked(classifyTransactions)).toHaveBeenCalledWith(supabaseAdmin, 'household-a', ['tx-a'], 'user-a');
	});

	it('marks the import as failed and skips classification when transaction persistence fails', async () => {
		const existingKeys = new QueryMock({ data: [], error: null });
		const importRecord = new QueryMock({ data: { id: 'import-a' }, error: null });
		const failedUpsert = new QueryMock({ data: null, error: { message: 'constraint failure' } });
		const failedImport = new QueryMock({ data: null, error: null });
		const adminQueries = [importRecord, failedUpsert, failedImport];
		mockedAdminFrom.mockImplementation(() => {
			const query = adminQueries.shift();
			if (!query) throw new Error('Unexpected admin query');
			return query as never;
		});

		const result = await actions.confirm({
			request: requestWithImport(),
			locals: {
				supabase: { from: () => existingKeys } as never,
				safeGetSession: async () => ({ user: { id: 'user-a' } })
			}
		} as never);

		expect(result).toMatchObject({ status: 500, message: 'constraint failure' });
		expect(failedImport.calls).toContainEqual({ method: 'update', args: [{ status: 'failed' }] });
		expect(failedImport.calls).toContainEqual({ method: 'eq', args: ['id', 'import-a'] });
		expect(vi.mocked(classifyTransactions)).not.toHaveBeenCalled();
	});

	it('finishes a duplicate-only import with zero inserted rows and no side effects', async () => {
		const existingKeys = new QueryMock({ data: [{ import_dedup_key: 'dedup-a' }], error: null });
		const importRecord = new QueryMock({ data: { id: 'import-a' }, error: null });
		const completedImport = new QueryMock({ data: null, error: null });
		const adminQueries = [importRecord, completedImport];
		mockedAdminFrom.mockImplementation(() => {
			const query = adminQueries.shift();
			if (!query) throw new Error('Unexpected admin query');
			return query as never;
		});

		await actions.confirm({
			request: requestWithImport(),
			locals: {
				supabase: { from: () => existingKeys } as never,
				safeGetSession: async () => ({ user: { id: 'user-a' } })
			}
		} as never);

		expect(completedImport.calls).toContainEqual({
			method: 'update',
			args: [{ status: 'classified', row_count: 0 }]
		});
		expect(mockedAdminFrom).toHaveBeenCalledTimes(2);
		expect(vi.mocked(classifyTransactions)).not.toHaveBeenCalled();
	});

	it('marks the import as failed when access grants cannot be persisted', async () => {
		const existingKeys = new QueryMock({ data: [], error: null });
		const importRecord = new QueryMock({ data: { id: 'import-a' }, error: null });
		const insertedTransactions = new QueryMock({
			data: [{ id: 'tx-a', amount: -10, date: '2026-05-01', description: 'Mercado', clean_description: 'MERCADO' }],
			error: null
		});
		const failedAccess = new QueryMock({ data: null, error: { message: 'access denied' } });
		const failedImport = new QueryMock({ data: null, error: null });
		const adminQueries = [importRecord, insertedTransactions, failedAccess, failedImport];
		mockedAdminFrom.mockImplementation(() => adminQueries.shift() as never);

		const result = await actions.confirm({
			request: requestWithImport(),
			locals: {
				supabase: { from: () => existingKeys } as never,
				safeGetSession: async () => ({ user: { id: 'user-a' } })
			}
		} as never);

		expect(result).toMatchObject({ status: 500, message: 'access denied' });
		expect(failedImport.calls).toContainEqual({ method: 'update', args: [{ status: 'failed' }] });
		expect(vi.mocked(classifyTransactions)).not.toHaveBeenCalled();
	});

	it('blocks classification when the persisted transaction count does not match', async () => {
		const existingKeys = new QueryMock({ data: [], error: null });
		const importRecord = new QueryMock({ data: { id: 'import-a' }, error: null });
		const insertedTransactions = new QueryMock({
			data: [{ id: 'tx-a', amount: -10, date: '2026-05-01', description: 'Mercado', clean_description: 'MERCADO' }],
			error: null
		});
		const accessInsert = new QueryMock({ data: null, error: null });
		const persisted = new QueryMock({ data: null, count: 0, error: null });
		const failedImport = new QueryMock({ data: null, error: null });
		const adminQueries = [importRecord, insertedTransactions, accessInsert, persisted, failedImport];
		mockedAdminFrom.mockImplementation(() => adminQueries.shift() as never);

		const result = await actions.confirm({
			request: requestWithImport(),
			locals: {
				supabase: { from: () => existingKeys } as never,
				safeGetSession: async () => ({ user: { id: 'user-a' } })
			}
		} as never);

		expect(result).toMatchObject({ status: 500 });
		expect(failedImport.calls).toContainEqual({ method: 'update', args: [{ status: 'failed' }] });
		expect(vi.mocked(classifyTransactions)).not.toHaveBeenCalled();
	});

	it('keeps imported rows recoverable and marks the import failed when classification throws', async () => {
		const existingKeys = new QueryMock({ data: [], error: null });
		const importRecord = new QueryMock({ data: { id: 'import-a' }, error: null });
		const insertedTransactions = new QueryMock({
			data: [{ id: 'tx-a', amount: -10, date: '2026-05-01', description: 'Mercado', clean_description: 'MERCADO' }],
			error: null
		});
		const accessInsert = new QueryMock({ data: null, error: null });
		const persisted = new QueryMock({ data: null, count: 1, error: null });
		const failedImport = new QueryMock({ data: null, error: null });
		const adminQueries = [importRecord, insertedTransactions, accessInsert, persisted, failedImport];
		mockedAdminFrom.mockImplementation(() => adminQueries.shift() as never);
		vi.mocked(classifyTransactions).mockRejectedValue(new Error('provider unavailable'));

		const result = await actions.confirm({
			request: requestWithImport(),
			locals: {
				supabase: { from: () => existingKeys } as never,
				safeGetSession: async () => ({ user: { id: 'user-a' } })
			}
		} as never);

		expect(result).toMatchObject({
			status: 500,
			message: 'As transações foram importadas, mas a classificação automática falhou. Tente classificar novamente.'
		});
		expect(failedImport.calls).toContainEqual({ method: 'update', args: [{ status: 'failed' }] });
	});
});

describe('import access repair', () => {
	it('rejects non-admin users before reading transactions with the admin client', async () => {
		vi.mocked(isHouseholdAdmin).mockResolvedValue(false);

		const result = await actions.repair_access({
			locals: { supabase: {} as never, safeGetSession: async () => ({ user: { id: 'user-a' } }) }
		} as never);

		expect(result).toMatchObject({ status: 403 });
		expect(mockedAdminFrom).not.toHaveBeenCalled();
	});

	it('surfaces access repair persistence failures with the calculated permissions', async () => {
		vi.mocked(getHouseholdMembers).mockResolvedValue(['user-a', 'user-b']);
		const transactions = new QueryMock({
			data: [{ id: 'tx-a', created_by_user_id: 'user-a', owner_profile: { type: 'shared', user_id: null } }],
			error: null
		});
		const existing = new QueryMock({ data: [], error: null });
		const insertion = new QueryMock({ data: null, error: { message: 'repair insert failed' } });
		const queries = [transactions, existing, insertion];
		mockedAdminFrom.mockImplementation(() => queries.shift() as never);

		const result = await actions.repair_access({
			locals: { supabase: {} as never, safeGetSession: async () => ({ user: { id: 'user-a' } }) }
		} as never);

		expect(result).toMatchObject({ status: 500, message: 'repair insert failed' });
		expect(insertion.calls).toContainEqual({
			method: 'insert',
			args: [[
				{ transaction_id: 'tx-a', user_id: 'user-a', can_read: true, can_edit: true },
				{ transaction_id: 'tx-a', user_id: 'user-b', can_read: true, can_edit: true }
			]]
		});
	});
});
