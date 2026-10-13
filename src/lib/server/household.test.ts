import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseAdmin } from '$lib/server/supabase';
import { getUserHouseholdId } from './household';

vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

const mockedFrom = vi.mocked(supabaseAdmin.from);

function membershipQuery(householdId: string | null) {
	const query = {
		select: () => query,
		eq: () => query,
		order: () => query,
		limit: () =>
			Promise.resolve({
				data: householdId ? [{ household_id: householdId }] : [],
				error: null
			})
	};
	return query;
}

beforeEach(() => {
	mockedFrom.mockReset();
});

describe('getUserHouseholdId', () => {
	it('looks the household up once per request client', async () => {
		mockedFrom.mockImplementation(() => membershipQuery('group-a') as never);
		const request = {} as never;

		const [first, second] = await Promise.all([
			getUserHouseholdId(request, 'user-a'),
			getUserHouseholdId(request, 'user-a')
		]);
		const third = await getUserHouseholdId(request, 'user-a');

		expect([first, second, third]).toEqual(['group-a', 'group-a', 'group-a']);
		expect(mockedFrom).toHaveBeenCalledTimes(1);
	});

	it('does not share lookups between requests', async () => {
		mockedFrom.mockImplementation(() => membershipQuery('group-a') as never);

		await getUserHouseholdId({} as never, 'user-a');
		await getUserHouseholdId({} as never, 'user-a');

		expect(mockedFrom).toHaveBeenCalledTimes(2);
	});

	// A group created or joined by a form action must be seen by the loads
	// that run after it in the same request.
	it('asks again after finding no household', async () => {
		const request = {} as never;
		mockedFrom.mockImplementationOnce(() => membershipQuery(null) as never);
		mockedFrom.mockImplementationOnce(
			() => membershipQuery('group-a') as never
		);

		expect(await getUserHouseholdId(request, 'user-a')).toBeNull();
		expect(await getUserHouseholdId(request, 'user-a')).toBe('group-a');
	});
});
