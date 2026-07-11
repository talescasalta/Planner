import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from '../../routes/app/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getReadableTransactionIds } from '$lib/server/access';
import { getUserHouseholdId } from '$lib/server/household';
import { loadCategoriesForUser } from '$lib/server/categories';
import { callLlm } from '$lib/server/llm';

vi.mock('@sveltejs/kit', () => ({ fail: (status: number, data: Record<string, unknown>) => ({ status, ...data }) }));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/access', () => ({ getReadableTransactionIds: vi.fn() }));
vi.mock('$lib/server/household', () => ({ getUserHouseholdId: vi.fn() }));
vi.mock('$lib/server/categories', () => ({ loadCategoriesForUser: vi.fn() }));
vi.mock('$lib/server/llm', () => ({ callLlm: vi.fn() }));

type QueryResult = { data?: unknown; error?: { message: string } | null };
class QueryMock {
	constructor(private readonly result: QueryResult) {}
	select() { return this; }
	eq() { return this; }
	in() { return this; }
	order() { return this; }
	then(resolve: (value: QueryResult) => unknown) { return Promise.resolve(resolve(this.result)); }
}

function requestForMonth(month: string) {
	const formData = new FormData();
	formData.set('month', month);
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

beforeEach(() => {
	vi.mocked(supabaseAdmin.from).mockReset();
	vi.mocked(getReadableTransactionIds).mockReset();
	vi.mocked(getUserHouseholdId).mockReset();
	vi.mocked(loadCategoriesForUser).mockReset();
	vi.mocked(callLlm).mockReset();
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(getReadableTransactionIds).mockResolvedValue([]);
	vi.mocked(loadCategoriesForUser).mockResolvedValue([]);
});

describe('dashboard insights action', () => {
	it('rejects unauthenticated insight generation before reading financial data', async () => {
		const result = await actions.insights(event(requestForMonth('2026-07'), false));

		expect(result).toMatchObject({ status: 401 });
		expect(getReadableTransactionIds).not.toHaveBeenCalled();
		expect(callLlm).not.toHaveBeenCalled();
	});

	it('rejects invalid months before household or transaction queries', async () => {
		const result = await actions.insights(event(requestForMonth('July')));

		expect(result).toMatchObject({ status: 400, message: 'Mês inválido' });
		expect(getUserHouseholdId).not.toHaveBeenCalled();
	});

	it('does not call the provider when there are no visible transactions', async () => {
		const result = await actions.insights(event(requestForMonth('2026-07')));

		expect(result).toMatchObject({ status: 400, message: 'Sem transações neste mês para analisar.' });
		expect(callLlm).not.toHaveBeenCalled();
	});

	it('surfaces provider failures without inventing insights', async () => {
		vi.mocked(getReadableTransactionIds).mockResolvedValue(['tx-a']);
		vi.mocked(supabaseAdmin.from).mockReturnValue(new QueryMock({ data: [{
			id: 'tx-a', amount: -100, currency: 'BRL', date: '2026-07-10', description: 'Mercado',
			clean_description: 'MERCADO', reference_month: '2026-07', review_status: 'confirmed',
			category_id: null, subcategory_id: null, owner_profile_id: null, paid_by_user_id: null,
			installment_number: null, installment_total: null, installment_group_key: null,
			category: null, subcategory: null, owner_profile: null
		}], error: null }) as never);
		vi.mocked(callLlm).mockRejectedValue(new Error('provider unavailable'));

		const result = await actions.insights(event(requestForMonth('2026-07')));

		expect(result).toMatchObject({ status: 500, success: false });
		expect(callLlm).toHaveBeenCalledOnce();
	});
});
