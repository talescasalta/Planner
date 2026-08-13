import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions } from '../../routes/app/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getUserHouseholdId } from '$lib/server/household';
import { loadCategoriesForUser } from '$lib/server/categories';
import { callLlm } from '$lib/server/llm';

vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data: Record<string, unknown>) => ({ status, ...data })
}));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({ getUserHouseholdId: vi.fn() }));
vi.mock('$lib/server/categories', () => ({ loadCategoriesForUser: vi.fn() }));
vi.mock('$lib/server/llm', () => ({ callLlm: vi.fn() }));

type QueryResult = { data?: unknown; error?: { message: string } | null };
class QueryMock {
	selects: string[] = [];
	eqs: Array<[string, unknown]> = [];
	constructor(private readonly result: QueryResult) {}
	select(columns?: string) {
		this.selects.push(columns ?? '');
		return this;
	}
	eq(column: string, value: unknown) {
		this.eqs.push([column, value]);
		return this;
	}
	ins: Array<[string, unknown]> = [];
	in(column: string, values: unknown) {
		this.ins.push([column, values]);
		return this;
	}
	order() {
		return this;
	}
	then(resolve: (value: QueryResult) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
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
			safeGetSession: async () => ({
				user: authenticated ? { id: 'user-a' } : null
			})
		}
	} as never;
}

beforeEach(() => {
	vi.mocked(supabaseAdmin.from).mockReset();
	vi.mocked(getUserHouseholdId).mockReset();
	vi.mocked(loadCategoriesForUser).mockReset();
	vi.mocked(callLlm).mockReset();
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(loadCategoriesForUser).mockResolvedValue([]);
	vi.mocked(supabaseAdmin.from).mockReturnValue(
		new QueryMock({ data: [], error: null }) as never
	);
});

describe('dashboard insights action', () => {
	it('rejects unauthenticated insight generation before reading financial data', async () => {
		const result = await actions.insights(
			event(requestForMonth('2026-07'), false)
		);

		expect(result).toMatchObject({ status: 401 });
		expect(supabaseAdmin.from).not.toHaveBeenCalled();
		expect(callLlm).not.toHaveBeenCalled();
	});

	it('rejects invalid months before household or transaction queries', async () => {
		const result = await actions.insights(event(requestForMonth('July')));

		expect(result).toMatchObject({ status: 400, message: 'Mês inválido' });
		expect(getUserHouseholdId).not.toHaveBeenCalled();
	});

	it('does not call the provider when there are no visible transactions', async () => {
		const result = await actions.insights(event(requestForMonth('2026-07')));

		expect(result).toMatchObject({
			status: 400,
			message: 'Sem transações neste mês para analisar.'
		});
		expect(callLlm).not.toHaveBeenCalled();
	});

	// Regression guard: the readable rows used to be narrowed by passing every
	// permitted transaction id into `.in('id', ...)`. That URL grew with the
	// household's history and eventually exceeded what PostgREST accepts,
	// taking the page down with a 400. The access check must ride along as a
	// join filter so the request stays a fixed size.
	it('narrows visible rows by joining transaction_access, not by an id list', async () => {
		const query = new QueryMock({ data: [], error: null });
		vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);

		await actions.insights(event(requestForMonth('2026-07')));

		expect(query.selects.join(' ')).toContain('transaction_access!inner');
		expect(query.eqs).toContainEqual(['transaction_access.user_id', 'user-a']);
		expect(query.eqs).toContainEqual(['transaction_access.can_read', true]);
		expect(query.ins).toEqual([]);
	});

	it('surfaces provider failures without inventing insights', async () => {
		vi.mocked(supabaseAdmin.from).mockReturnValue(
			new QueryMock({
				data: [
					{
						id: 'tx-a',
						amount: -100,
						currency: 'BRL',
						date: '2026-07-10',
						description: 'Mercado',
						clean_description: 'MERCADO',
						reference_month: '2026-07',
						review_status: 'confirmed',
						category_id: null,
						subcategory_id: null,
						owner_profile_id: null,
						paid_by_user_id: null,
						installment_number: null,
						installment_total: null,
						installment_group_key: null,
						category: null,
						subcategory: null,
						owner_profile: null
					}
				],
				error: null
			}) as never
		);
		vi.mocked(callLlm).mockRejectedValue(new Error('provider unavailable'));

		const result = await actions.insights(event(requestForMonth('2026-07')));

		expect(result).toMatchObject({ status: 500, success: false });
		expect(callLlm).toHaveBeenCalledOnce();
	});
});
