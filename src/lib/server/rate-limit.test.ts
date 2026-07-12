import { describe, expect, it } from 'vitest';
import { checkPersistentRateLimit } from './rate-limit';

describe('checkPersistentRateLimit', () => {
	it('allows requests below the configured window limit', async () => {
		const calls: unknown[] = [];
		const supabase = {
			rpc: (_name: string, params: unknown) => {
				calls.push(params);
				return Promise.resolve({ data: true, error: null });
			}
		} as never;

		await expect(
			checkPersistentRateLimit(supabase, 'user-a', {
				windowMs: 60_000,
				maxRequests: 10
			})
		).resolves.toBe(true);
		expect(calls).toEqual([
			{
				p_user_id: 'user-a',
				p_window_seconds: 60,
				p_max_requests: 10,
				p_cleanup_seconds: 3600
			}
		]);
	});

	it('blocks requests at the configured window limit', async () => {
		const supabase = {
			rpc: () => Promise.resolve({ data: false, error: null })
		} as never;

		await expect(
			checkPersistentRateLimit(supabase, 'user-a', {
				windowMs: 60_000,
				maxRequests: 10
			})
		).resolves.toBe(false);
	});
});
