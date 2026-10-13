import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	acceptInvitation,
	createInvitation,
	deleteInvitation
} from './household-invitations';

vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

type QueryResult = {
	data?: unknown;
	error?: { message: string; code?: string } | null;
};

class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];
	constructor(
		private readonly result: QueryResult = { data: null, error: null }
	) {}
	private record(method: string, args: unknown[]) {
		this.calls.push({ method, args });
		return this;
	}
	select(...args: unknown[]) {
		return this.record('select', args);
	}
	insert(...args: unknown[]) {
		return this.record('insert', args);
	}
	delete(...args: unknown[]) {
		return this.record('delete', args);
	}
	eq(...args: unknown[]) {
		return this.record('eq', args);
	}
	maybeSingle() {
		return Promise.resolve(this.result);
	}
	then(resolve: (value: QueryResult) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
}

const mockedFrom = vi.mocked(supabaseAdmin.from);

function queue(...queries: QueryMock[]) {
	mockedFrom.mockImplementation(() => queries.shift() as never);
}

beforeEach(() => {
	mockedFrom.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('household invitations', () => {
	it('looks the invitation up by the invitee, so another person’s id is not found', async () => {
		const lookup = new QueryMock({ data: null, error: null });
		queue(lookup);

		expect(await acceptInvitation('invite-1', 'user-b')).toBe('not_found');
		expect(lookup.calls).toContainEqual({
			method: 'eq',
			args: ['id', 'invite-1']
		});
		expect(lookup.calls).toContainEqual({
			method: 'eq',
			args: ['user_id', 'user-b']
		});
		expect(mockedFrom).toHaveBeenCalledTimes(1);
	});

	it('creates the membership as a plain member and spends the invitation', async () => {
		const lookup = new QueryMock({
			data: { id: 'invite-1', household_id: 'group-a' },
			error: null
		});
		const member = new QueryMock({ error: null });
		const cleanup = new QueryMock({ error: null });
		queue(lookup, member, cleanup);

		expect(await acceptInvitation('invite-1', 'user-b')).toBe('accepted');
		expect(member.calls).toContainEqual({
			method: 'insert',
			args: [{ household_id: 'group-a', user_id: 'user-b', role: 'member' }]
		});
		expect(cleanup.calls).toContainEqual({
			method: 'eq',
			args: ['user_id', 'user-b']
		});
	});

	it('treats an existing membership as accepted but other failures as errors', async () => {
		const found = () =>
			new QueryMock({
				data: { id: 'invite-1', household_id: 'group-a' },
				error: null
			});

		queue(
			found(),
			new QueryMock({ error: { message: 'duplicate', code: '23505' } }),
			new QueryMock({ error: null })
		);
		expect(await acceptInvitation('invite-1', 'user-b')).toBe('accepted');

		queue(
			found(),
			new QueryMock({ error: { message: 'boom', code: 'XX000' } })
		);
		expect(await acceptInvitation('invite-1', 'user-b')).toBe('error');
	});

	it('maps a repeated invitation to duplicate', async () => {
		queue(new QueryMock({ error: { message: 'duplicate', code: '23505' } }));

		expect(
			await createInvitation({
				householdId: 'group-a',
				userId: 'user-b',
				email: 'b@example.com',
				invitedByUserId: 'user-a'
			})
		).toBe('duplicate');
	});

	it('scopes a cancellation to the household', async () => {
		const deletion = new QueryMock({ error: null });
		queue(deletion);

		expect(
			await deleteInvitation({ id: 'invite-1', householdId: 'group-a' })
		).toBe(true);
		expect(deletion.calls).toContainEqual({
			method: 'eq',
			args: ['household_id', 'group-a']
		});
	});
});
