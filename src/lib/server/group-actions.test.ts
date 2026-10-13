import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '$lib/server/errors';
import { actions } from '../../routes/app/groups/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	seedDefaultCategories,
	seedDefaultFinancialProfiles
} from '$lib/server/household';
import { canEditTransaction, isHouseholdAdmin } from '$lib/server/access';
import {
	acceptInvitation,
	createInvitation,
	deleteInvitation
} from '$lib/server/household-invitations';

vi.mock('@sveltejs/kit', () => ({
	fail: (status: number, data: Record<string, unknown>) => ({
		status,
		...data
	}),
	redirect: vi.fn()
}));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({
	seedDefaultCategories: vi.fn(),
	seedDefaultFinancialProfiles: vi.fn()
}));
vi.mock('$lib/server/access', () => ({
	canEditTransaction: vi.fn(),
	getReadableTransactionIds: vi.fn(),
	isHouseholdAdmin: vi.fn()
}));
vi.mock('$lib/server/household-invitations', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('$lib/server/household-invitations')
	>()),
	acceptInvitation: vi.fn(),
	createInvitation: vi.fn(),
	deleteInvitation: vi.fn(),
	loadReceivedInvitations: vi.fn(),
	loadSentInvitations: vi.fn()
}));

type QueryResult = { data?: unknown; error?: { message: string } | null };
class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];
	constructor(
		private readonly result: QueryResult = { data: null, error: null }
	) {}
	select(...args: unknown[]) {
		this.calls.push({ method: 'select', args });
		return this;
	}
	insert(...args: unknown[]) {
		this.calls.push({ method: 'insert', args });
		return this;
	}
	update(...args: unknown[]) {
		this.calls.push({ method: 'update', args });
		return this;
	}
	delete(...args: unknown[]) {
		this.calls.push({ method: 'delete', args });
		return this;
	}
	eq(...args: unknown[]) {
		this.calls.push({ method: 'eq', args });
		return this;
	}
	order(...args: unknown[]) {
		this.calls.push({ method: 'order', args });
		return this;
	}
	single() {
		return Promise.resolve(this.result);
	}
	maybeSingle() {
		return Promise.resolve(this.result);
	}
	then(resolve: (value: QueryResult) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
}

function requestWith(fields: Record<string, string | string[]>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		for (const item of Array.isArray(value) ? value : [value])
			formData.append(key, item);
	}
	return { formData: async () => formData } as never;
}

function event(request: unknown, userSupabase: unknown = {}) {
	return {
		request,
		locals: {
			supabase: userSupabase,
			safeGetSession: async () => ({
				user: { id: 'user-a', email: 'a@example.com' },
				profile: null
			})
		}
	} as never;
}

const mockedFrom = vi.mocked(supabaseAdmin.from);

beforeEach(() => {
	mockedFrom.mockReset();
	vi.mocked(canEditTransaction).mockReset();
	vi.mocked(isHouseholdAdmin).mockReset();
	vi.mocked(seedDefaultCategories).mockReset();
	vi.mocked(seedDefaultFinancialProfiles).mockReset();
	vi.mocked(canEditTransaction).mockResolvedValue(true);
	vi.mocked(isHouseholdAdmin).mockResolvedValue(true);
	vi.mocked(seedDefaultCategories).mockResolvedValue(undefined);
	vi.mocked(seedDefaultFinancialProfiles).mockResolvedValue(undefined);
	vi.mocked(acceptInvitation).mockReset();
	vi.mocked(createInvitation).mockReset();
	vi.mocked(deleteInvitation).mockReset();
	vi.mocked(createInvitation).mockResolvedValue('created');
	vi.mocked(deleteInvitation).mockResolvedValue(true);
});

describe('group actions', () => {
	it('rejects income updates from anyone but a group admin', async () => {
		vi.mocked(isHouseholdAdmin).mockResolvedValue(false);

		const result = await actions.update_incomes(
			event(
				requestWith({
					group_id: 'group-a',
					user_id: 'user-a',
					monthly_income: '5000'
				})
			)
		);

		expect(result).toMatchObject({ status: 403 });
		expect(isHouseholdAdmin).toHaveBeenCalledWith({}, 'group-a', 'user-a');
		expect(mockedFrom).not.toHaveBeenCalled();
	});

	it('rejects income rows for users outside the group without updating anyone', async () => {
		const membership = new QueryMock({
			data: { user_id: 'user-a' },
			error: null
		});
		const members = new QueryMock({
			data: [{ user_id: 'user-a' }],
			error: null
		});
		mockedFrom.mockReturnValue(members as never);

		const result = await actions.update_incomes(
			event(
				requestWith({
					group_id: 'group-a',
					user_id: ['user-a', 'user-b'],
					monthly_income: ['5000', '3000']
				}),
				{ from: () => membership }
			)
		);

		expect(result).toMatchObject({
			status: 400,
			message: 'Renda enviada para membro inválido'
		});
		expect(mockedFrom).toHaveBeenCalledTimes(1);
	});

	it('surfaces partial income persistence failures and scopes every update', async () => {
		const membership = new QueryMock({
			data: { user_id: 'user-a' },
			error: null
		});
		const members = new QueryMock({
			data: [{ user_id: 'user-a' }, { user_id: 'user-b' }],
			error: null
		});
		const updateA = new QueryMock({ error: null });
		const updateB = new QueryMock({
			error: { message: 'income update failed' }
		});
		const queries = [members, updateA, updateB];
		mockedFrom.mockImplementation(() => queries.shift() as never);

		const result = await actions.update_incomes(
			event(
				requestWith({
					group_id: 'group-a',
					user_id: ['user-a', 'user-b'],
					monthly_income: ['5000', '3000']
				}),
				{ from: () => membership }
			)
		);

		expect(result).toMatchObject({
			status: 500,
			message: INTERNAL_ERROR_MESSAGE
		});
		for (const query of [updateA, updateB]) {
			expect(query.calls).toContainEqual({
				method: 'eq',
				args: ['household_id', 'group-a']
			});
		}
	});

	it('rejects split changes without transaction edit permission', async () => {
		vi.mocked(canEditTransaction).mockResolvedValue(false);

		const result = await actions.update_split_method(
			event(
				requestWith({
					group_id: 'group-a',
					transaction_id: 'tx-a',
					split_method: 'equal'
				})
			)
		);

		expect(result).toMatchObject({ status: 403 });
		expect(mockedFrom).not.toHaveBeenCalled();
	});

	it('surfaces a household-scoped split update failure', async () => {
		const transaction = new QueryMock({
			data: { amount: -100, owner_profile: { type: 'shared' } },
			error: null
		});
		const update = new QueryMock({ error: { message: 'split update failed' } });
		const queries = [transaction, update];
		mockedFrom.mockImplementation(() => queries.shift() as never);

		const result = await actions.update_split_method(
			event(
				requestWith({
					group_id: 'group-a',
					transaction_id: 'tx-a',
					split_method: 'equal'
				})
			)
		);

		expect(result).toMatchObject({
			status: 500,
			message: INTERNAL_ERROR_MESSAGE
		});
		expect(update.calls).toContainEqual({ method: 'eq', args: ['id', 'tx-a'] });
		expect(update.calls).toContainEqual({
			method: 'eq',
			args: ['household_id', 'group-a']
		});
	});

	it('rolls back the household when member creation fails', async () => {
		const household = new QueryMock({ data: { id: 'group-a' }, error: null });
		const member = new QueryMock({
			error: { message: 'member insert failed' }
		});
		const cleanup = new QueryMock({ error: null });
		const queries = [household, member, cleanup];
		mockedFrom.mockImplementation(() => queries.shift() as never);

		const result = await actions.create(event(requestWith({ name: 'Casa' })));

		expect(result).toMatchObject({
			status: 500,
			message: INTERNAL_ERROR_MESSAGE
		});
		expect(cleanup.calls).toContainEqual({ method: 'delete', args: [] });
		expect(cleanup.calls).toContainEqual({
			method: 'eq',
			args: ['id', 'group-a']
		});
		expect(seedDefaultCategories).not.toHaveBeenCalled();
	});

	it('rejects invitations from non-admin users', async () => {
		vi.mocked(isHouseholdAdmin).mockResolvedValue(false);

		const result = await actions.add_member(
			event(
				requestWith({
					group_id: 'group-a',
					email: 'member@example.com'
				})
			)
		);

		expect(result).toMatchObject({ status: 403 });
		expect(createInvitation).not.toHaveBeenCalled();
		expect(mockedFrom).not.toHaveBeenCalled();
	});

	it('invites by e-mail instead of adding the member directly', async () => {
		const result = await actions.add_member(
			event(
				requestWith({
					group_id: 'group-a',
					email: ' MEMBER@example.com '
				})
			)
		);

		expect(result).toMatchObject({ success: true });
		expect(createInvitation).toHaveBeenCalledWith({
			householdId: 'group-a',
			email: 'member@example.com',
			invitedByUserId: 'user-a'
		});
		// No membership is written: the invitee joins only by accepting.
		expect(mockedFrom).not.toHaveBeenCalled();
	});

	it('reports a pending invitation and a failed one without the raw error', async () => {
		const invite = () =>
			actions.add_member(
				event(requestWith({ group_id: 'group-a', email: 'member@example.com' }))
			);

		vi.mocked(createInvitation).mockResolvedValue('duplicate');
		expect(await invite()).toMatchObject({ status: 400 });

		vi.mocked(createInvitation).mockResolvedValue('error');
		expect(await invite()).toMatchObject({
			status: 500,
			message: 'Não foi possível enviar o convite. Tente novamente.'
		});
	});

	// Without an account lookup, a registered and an unregistered e-mail get
	// the same answer, so inviting cannot reveal who has an account.
	it('answers the same whether or not the e-mail has an account', async () => {
		const invite = (email: string) =>
			actions.add_member(event(requestWith({ group_id: 'group-a', email })));

		const registered = await invite('a@example.com');
		const unknown = await invite('nobody@example.com');

		expect(mockedFrom).not.toHaveBeenCalled();
		expect(Object.keys(unknown as object)).toEqual(
			Object.keys(registered as object)
		);
		expect(unknown).toMatchObject({ success: true });
	});

	it('refuses an invalid e-mail before writing anything', async () => {
		const result = await actions.add_member(
			event(requestWith({ group_id: 'group-a', email: 'not-an-email' }))
		);

		expect(result).toMatchObject({ status: 400 });
		expect(createInvitation).not.toHaveBeenCalled();
	});

	it('accepts only the invitee’s own invitation', async () => {
		vi.mocked(acceptInvitation).mockResolvedValue('not_found');

		const result = await actions.accept_invitation(
			event(requestWith({ invitation_id: 'invite-1' }))
		);

		expect(acceptInvitation).toHaveBeenCalledWith(
			'invite-1',
			expect.objectContaining({ id: 'user-a', email: 'a@example.com' })
		);
		expect(result).toMatchObject({ status: 404 });
	});

	it('scopes a declined invitation to the invitee', async () => {
		const result = await actions.decline_invitation(
			event(requestWith({ invitation_id: 'invite-1' }))
		);

		expect(result).toMatchObject({ success: true });
		expect(deleteInvitation).toHaveBeenCalledWith({
			id: 'invite-1',
			email: 'a@example.com'
		});
	});

	it('lets only admins cancel an invitation, scoped to their group', async () => {
		vi.mocked(isHouseholdAdmin).mockResolvedValue(false);
		const denied = await actions.cancel_invitation(
			event(requestWith({ group_id: 'group-a', invitation_id: 'invite-1' }))
		);
		expect(denied).toMatchObject({ status: 403 });
		expect(deleteInvitation).not.toHaveBeenCalled();

		vi.mocked(isHouseholdAdmin).mockResolvedValue(true);
		const allowed = await actions.cancel_invitation(
			event(requestWith({ group_id: 'group-a', invitation_id: 'invite-1' }))
		);
		expect(allowed).toMatchObject({ success: true });
		expect(deleteInvitation).toHaveBeenCalledWith({
			id: 'invite-1',
			householdId: 'group-a'
		});
	});

	it('scopes member removals and propagates delete failures', async () => {
		const deletion = new QueryMock({
			error: { message: 'member remove failed' }
		});
		mockedFrom.mockReturnValue(deletion as never);

		const result = await actions.remove_member(
			event(
				requestWith({
					group_id: 'group-a',
					user_id: 'user-b'
				})
			)
		);

		expect(result).toMatchObject({
			status: 500,
			message: INTERNAL_ERROR_MESSAGE
		});
		expect(deletion.calls).toContainEqual({
			method: 'eq',
			args: ['household_id', 'group-a']
		});
		expect(deletion.calls).toContainEqual({
			method: 'eq',
			args: ['user_id', 'user-b']
		});
	});
});
