import { describe, expect, it } from 'vitest';
import { loadOnboardingFacts } from './onboarding';

type Result = {
	data?: unknown;
	count?: number | null;
	error: unknown;
};

// Every builder method returns the chain; awaiting it yields the result.
function chain(result: Result) {
	const query = {
		select: () => query,
		eq: () => query,
		maybeSingle: () => Promise.resolve(result),
		then: (resolve: (value: Result) => unknown) => resolve(result)
	};
	return query;
}

function fakeDb(results: Record<string, Result>) {
	return { from: (table: string) => chain(results[table]) } as never;
}

const ok = (data: unknown, count: number | null = null) => ({
	data,
	count,
	error: null
});

describe('loadOnboardingFacts', () => {
	it('reports an account without a group as a fresh start', async () => {
		expect(await loadOnboardingFacts(fakeDb({}), null)).toEqual({
			hasGroup: false,
			hasOwnNames: false,
			transactionCount: 0,
			memberCount: 0,
			membersWithIncome: 0
		});
	});

	it('counts names, members with income and transactions', async () => {
		const db = fakeDb({
			households: ok({ own_account_names: ['Maria Silva'] }),
			household_members: ok([{ monthly_income: 5000 }, { monthly_income: 0 }]),
			transactions: ok(null, 42)
		});

		expect(await loadOnboardingFacts(db, 'household-a')).toEqual({
			hasGroup: true,
			hasOwnNames: true,
			transactionCount: 42,
			memberCount: 2,
			membersWithIncome: 1
		});
	});

	it('hides the checklist when a read fails', async () => {
		const db = fakeDb({
			households: ok({ own_account_names: [] }),
			household_members: { data: null, error: new Error('boom') },
			transactions: ok(null, 0)
		});

		expect(await loadOnboardingFacts(db, 'household-a')).toBeNull();
	});

	it('hides the checklist when the client throws', async () => {
		const db = {
			from: () => {
				throw new Error('offline');
			}
		} as never;

		expect(await loadOnboardingFacts(db, 'household-a')).toBeNull();
	});
});
