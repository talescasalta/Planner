import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../../routes/app/transactions/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getUserHouseholdId, attachPayerProfiles } from '$lib/server/household';
import { filterByReadableAccess } from '$lib/server/access';
import { loadUserCategoryExclusions } from '$lib/server/categories';
import { filterCategoriesForUser } from '$lib/server/gabarito';

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

type AmountFilter = { method: 'gt' | 'lt'; column: string; value: unknown };

// Records every filter the page puts on a query so a test can ask what the
// whole load did, without depending on the order of the parallel queries.
const amountFilters: AmountFilter[] = [];

class QueryMock {
	select() {
		return this;
	}
	eq() {
		return this;
	}
	neq() {
		return this;
	}
	in() {
		return this;
	}
	is() {
		return this;
	}
	order() {
		return this;
	}
	range() {
		return this;
	}
	gt(column: string, value: unknown) {
		amountFilters.push({ method: 'gt', column, value });
		return this;
	}
	lt(column: string, value: unknown) {
		amountFilters.push({ method: 'lt', column, value });
		return this;
	}
	single() {
		return Promise.resolve({ data: null, error: null });
	}
	then(resolve: (value: { data: unknown; error: null }) => unknown) {
		return Promise.resolve(resolve({ data: [], error: null }));
	}
}

function event(url: string) {
	return {
		url: new URL(url, 'https://planner.test'),
		locals: {
			supabase: {} as never,
			safeGetSession: async () => ({ user: { id: 'user-a' } })
		}
	} as never;
}

beforeEach(() => {
	amountFilters.length = 0;
	vi.mocked(supabaseAdmin.from).mockReset();
	vi.mocked(supabaseAdmin.from).mockImplementation(
		() => new QueryMock() as never
	);
	vi.mocked(filterByReadableAccess).mockImplementation((query) => query);
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(attachPayerProfiles).mockResolvedValue([]);
	vi.mocked(loadUserCategoryExclusions).mockResolvedValue(new Set());
	vi.mocked(filterCategoriesForUser).mockReturnValue([]);
});

describe('income and expense drill-down', () => {
	// The dashboard's Receitas card links here; without the filter the figure
	// could only be traced by reading the whole month by hand.
	it('narrows to credits when the direction filter asks for income', async () => {
		const result = (await load(
			event('/app/transactions?month=2026-08&direction=in')
		)) as { filters: { direction: string } };

		expect(amountFilters).toContainEqual({
			method: 'gt',
			column: 'amount',
			value: 0
		});
		expect(amountFilters.every((f) => f.method === 'gt')).toBe(true);
		expect(result.filters.direction).toBe('in');
	});

	it('narrows to debits when the direction filter asks for expenses', async () => {
		await load(event('/app/transactions?month=2026-08&direction=out'));

		expect(amountFilters).toContainEqual({
			method: 'lt',
			column: 'amount',
			value: 0
		});
		expect(amountFilters.every((f) => f.method === 'lt')).toBe(true);
	});

	it('leaves the amount unfiltered by default', async () => {
		const result = (await load(event('/app/transactions?month=2026-08'))) as {
			filters: { direction: string };
		};

		expect(amountFilters).toEqual([]);
		expect(result.filters.direction).toBe('all');
	});

	// An unrecognised value must not silently filter the list to nothing.
	it('ignores a direction it does not recognise', async () => {
		const result = (await load(
			event('/app/transactions?month=2026-08&direction=sideways')
		)) as { filters: { direction: string } };

		expect(amountFilters).toEqual([]);
		expect(result.filters.direction).toBe('all');
	});
});
