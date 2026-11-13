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
vi.mock('$lib/server/accounts', () => ({
	loadAccountNames: vi.fn(async () => [])
}));
vi.mock('$lib/server/categories', () => ({
	loadCategoriesForUser: vi.fn(),
	loadUserCategoryExclusions: vi.fn()
}));

// Rows as the query returns them: newest first. The list loads them all and
// cuts pages afterwards, so a sort must run over the whole month.
function row(id: string, date: string, amount: number) {
	return {
		id,
		date,
		amount,
		description: id,
		category_id: null,
		subcategory_id: null,
		category: null,
		subcategory: null,
		classification_suggestion: null,
		is_transfer: false,
		financial_treatment_override: null
	};
}

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
	gt() {
		return this;
	}
	lt() {
		return this;
	}
	order() {
		return this;
	}
	range() {
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

// 120 small rows dated late in the month, then one large debit early in the month:
// by date it lands on page 2 (index 120), past the 100-row page.
const rows = [
	...Array.from({ length: 120 }, (_, i) =>
		row(`small-${i}`, '2026-10-20', -(10 + i))
	),
	row('large', '2026-10-03', -9000)
];

type LoadResult = {
	transactions: Array<{ id: string; amount: number }>;
	filters: { sort: string };
	hasMore: boolean;
};

beforeEach(() => {
	vi.mocked(supabaseAdmin.from).mockReset();
	vi.mocked(supabaseAdmin.from).mockImplementation(
		() => new QueryMock() as never
	);
	vi.mocked(filterByReadableAccess).mockImplementation((query) => query);
	vi.mocked(getUserHouseholdId).mockResolvedValue('household-a');
	vi.mocked(attachPayerProfiles).mockResolvedValue(rows as never);
	vi.mocked(loadUserCategoryExclusions).mockResolvedValue(new Set());
	vi.mocked(filterCategoriesForUser).mockReturnValue([]);
});

describe('sorting transactions by amount', () => {
	it('keeps date order and pages by date when no sort is asked', async () => {
		const result = (await load(
			event('/app/transactions?month=2026-10')
		)) as LoadResult;

		expect(result.filters.sort).toBe('');
		expect(result.transactions.map((t) => t.id)).not.toContain('large');
		expect(result.hasMore).toBe(true);
	});

	// The bug: the column sort only reordered the loaded page, so the largest
	// debit of the month never showed at the top.
	it('puts the largest debit of the whole month first when sorting ascending', async () => {
		const result = (await load(
			event('/app/transactions?month=2026-10&sort=amount_asc')
		)) as LoadResult;

		expect(result.filters.sort).toBe('amount_asc');
		expect(result.transactions[0]).toMatchObject({
			id: 'large',
			amount: -9000
		});
		expect(result.transactions).toHaveLength(100);
	});

	it('leaves the largest debit for the last page when sorting descending', async () => {
		const page2 = (await load(
			event('/app/transactions?month=2026-10&sort=amount_desc&page=1')
		)) as LoadResult;

		expect(page2.transactions.at(-1)).toMatchObject({ id: 'large' });
		expect(page2.hasMore).toBe(false);
	});

	it('ignores a sort it does not recognise', async () => {
		const result = (await load(
			event('/app/transactions?month=2026-10&sort=bogus')
		)) as LoadResult;

		expect(result.filters.sort).toBe('');
		expect(result.transactions[0].id).toBe('small-0');
	});
});

type SearchResult = LoadResult & {
	filters: { q: string };
	summary: { count: number };
};

describe('searching transactions', () => {
	// The box used to filter only the 100 loaded rows, so a match dated early
	// in the month (page 2 by date) was never found.
	it('finds a match beyond the first page and pages the matches only', async () => {
		const result = (await load(
			event('/app/transactions?month=2026-10&q=large')
		)) as SearchResult;

		expect(result.filters.q).toBe('large');
		expect(result.transactions.map((t) => t.id)).toEqual(['large']);
		expect(result.hasMore).toBe(false);
		expect(result.summary.count).toBe(1);
	});

	it('combines with the amount sort', async () => {
		const result = (await load(
			event('/app/transactions?month=2026-10&q=small-11&sort=amount_asc')
		)) as SearchResult;

		// small-11 and small-110..119 match; the most negative comes first.
		expect(result.transactions[0].id).toBe('small-119');
		expect(result.transactions).toHaveLength(11);
	});

	it('treats a blank term as no search', async () => {
		const result = (await load(
			event('/app/transactions?month=2026-10&q=%20%20')
		)) as SearchResult;

		expect(result.filters.q).toBe('');
		expect(result.transactions).toHaveLength(100);
	});
});
