import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

export type RateLimitOptions = {
	windowMs: number;
	maxRequests: number;
	cleanupOlderThanMs?: number;
};

export async function checkPersistentRateLimit(
	supabase: SupabaseClient<Database>,
	userId: string,
	options: RateLimitOptions
): Promise<boolean> {
	const { data, error } = await supabase.rpc('check_classification_rate_limit', {
		p_user_id: userId,
		p_window_seconds: Math.ceil(options.windowMs / 1000),
		p_max_requests: options.maxRequests,
		p_cleanup_seconds: Math.ceil((options.cleanupOlderThanMs ?? 60 * 60_000) / 1000)
	});
	if (error) return false;
	return data === true;
}
