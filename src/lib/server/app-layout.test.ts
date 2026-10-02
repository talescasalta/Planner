import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from '../../routes/app/+layout.server';
import { supabaseAdmin } from '$lib/server/supabase';
import { getUserHouseholdId } from '$lib/server/household';

vi.mock('@sveltejs/kit', () => ({
	redirect: (status: number, location: string) => {
		throw new Error(`redirect:${status}:${location}`);
	}
}));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock('$lib/server/household', () => ({ getUserHouseholdId: vi.fn() }));

type Result = { count?: number | null; error?: { message: string } | null };
class CountQuery {
	eqs: Array<[string, unknown]> = [];
	constructor(private readonly result: Result) {}
	select() {
		return this;
	}
	eq(column: string, value: unknown) {
		this.eqs.push([column, value]);
		return this;
	}
	then(resolve: (value: Result) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
}

function run() {
	return load({
		locals: {
			supabase: {} as never,
			safeGetSession: async () => ({
				session: { id: 's' },
				user: { id: 'user-a' },
				profile: null
			})
		}
	} as never) as Promise<{ reviewCount: number | null }>;
}

describe('app layout load', () => {
	beforeEach(() => {
		vi.mocked(getUserHouseholdId).mockReset();
		vi.mocked(supabaseAdmin.from).mockReset();
	});

	it('counts transactions waiting for review', async () => {
		vi.mocked(getUserHouseholdId).mockResolvedValue('house-1');
		const query = new CountQuery({ count: 47, error: null });
		vi.mocked(supabaseAdmin.from).mockReturnValue(query as never);
		expect((await run()).reviewCount).toBe(47);
		expect(query.eqs).toContainEqual(['household_id', 'house-1']);
		expect(query.eqs).toContainEqual(['review_status', 'needs_review']);
		expect(query.eqs).toContainEqual(['transaction_access.user_id', 'user-a']);
	});

	it('turns a query error into null', async () => {
		vi.mocked(getUserHouseholdId).mockResolvedValue('house-1');
		vi.mocked(supabaseAdmin.from).mockReturnValue(
			new CountQuery({ count: null, error: { message: 'boom' } }) as never
		);
		expect((await run()).reviewCount).toBeNull();
	});

	it('turns a thrown error into null', async () => {
		vi.mocked(getUserHouseholdId).mockRejectedValue(new Error('down'));
		expect((await run()).reviewCount).toBeNull();
	});

	it('returns null without a household', async () => {
		vi.mocked(getUserHouseholdId).mockResolvedValue(null);
		expect((await run()).reviewCount).toBeNull();
		expect(supabaseAdmin.from).not.toHaveBeenCalled();
	});
});
