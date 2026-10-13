import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '$lib/server/errors';
import { actions } from '../../routes/app/groups/+page.server';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	seedDefaultCategories,
	seedDefaultFinancialProfiles
} from '$lib/server/household';
import { canEditTransaction, isHouseholdAdmin } from '$lib/server/access';
import { findAuthUserByEmail } from '$lib/server/auth-admin';
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
vi.mock('$lib/server/auth-admin', () => ({ findAuthUserByEmail: vi.fn() }));
vi.mock('$lib/server/household-invitations', () => ({
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
	vi.mocked(findAuthUserByEmail).mockReset();
	vi.mocked(canEditTransaction).mockResolvedValue(true);
	vi.mocked(isHouseholdAdmin).mockResolvedValue(true);
	vi.mocked(seedDefaultCategories).mockResolvedValue(undefined);
	vi.mocked(seedDefaultFinancialProfiles).mockResolvedValue(undefined);
	vi.mocked(findAuthUserByEmail).mockResolvedValue(null);
	vi.mocked(acceptInvitation).mockReset();
	vi.mocked(createInvitation).mockReset();
	vi.mocked(deleteInvitation).mockReset();
	vi.mocked(createInvitation).mockResolvedValue('created');
	vi.mocked(deleteInvitation).mockResolvedValue(true);
});

describe('group actions', () => {
	it('rejects income updates from a non-member before admin writes', async () => {
		const membership = new QueryMock({ data: null, error: null });
		const userSupabase = { from: vi.fn(() => membership) };

		const result = await actions.update_incomes(
			event(
				requestWith({
					group_id: 'group-a',
					user_id: 'user-a',
					monthly_income: '5000'
				}),
				userSupabase
			)
		);

		expect(result).toMatchObject({ status: 403 });
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

	it('rejects member additions from non-admin users before auth lookup', async () => {
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
		expect(findAuthUserByEmail).not.toHaveBeenCalled();
		expect(mockedFrom).not.toHaveBeenCalled();
	});

	it('invites instead of adding the member directly', async () => {
		vi.mocked(findAuthUserByEmail).mockResolvedValue({ id: 'user-b' } as never);
		const existing = new QueryMock({ data: null, error: null });

		const result = await actions.add_member(
			event(
				requestWith({
					group_id: 'group-a',
					email: 'MEMBER@example.com'
				}),
				{ from: () => existing }
			)
		);

		expect(result).toMatchObject({ success: true });
		expect(createInvitation).toHaveBeenCalledWith({
			householdId: 'group-a',
			userId: 'user-b',
			email: 'member@example.com',
			invitedByUserId: 'user-a'
		});
		// No membership is written: the invitee joins only by accepting.
		expect(mockedFrom).not.toHaveBeenCalled();
	});

	it('reports a pending invitation and a failed one without the raw error', async () => {
		vi.mocked(findAuthUserByEmail).mockResolvedValue({ id: 'user-b' } as never);
		const existing = new QueryMock({ data: null, error: null });
		const invite = () =>
			actions.add_member(
				event(
					requestWith({ group_id: 'group-a', email: 'member@example.com' }),
					{ from: () => existing }
				)
			);

		vi.mocked(createInvitation).mockResolvedValue('duplicate');
		expect(await invite()).toMatchObject({ status: 400 });

		vi.mocked(createInvitation).mockResolvedValue('error');
		expect(await invite()).toMatchObject({
			status: 500,
			message: 'Não foi possível enviar o convite. Tente novamente.'
		});
	});

	it('accepts only the invitee’s own invitation', async () => {
		vi.mocked(acceptInvitation).mockResolvedValue('not_found');

		const result = await actions.accept_invitation(
			event(requestWith({ invitation_id: 'invite-1' }))
		);

		expect(acceptInvitation).toHaveBeenCalledWith('invite-1', 'user-a');
		expect(result).toMatchObject({ status: 404 });
	});

	it('scopes a declined invitation to the invitee', async () => {
		const result = await actions.decline_invitation(
			event(requestWith({ invitation_id: 'invite-1' }))
		);

		expect(result).toMatchObject({ success: true });
		expect(deleteInvitation).toHaveBeenCalledWith({
			id: 'invite-1',
			userId: 'user-a'
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
