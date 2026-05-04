import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { classifyTransactions } from '$lib/server/classifier';
import { getUserHouseholdId } from '$lib/server/household';

const MAX_IDS_PER_REQUEST = 200;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

const buckets = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
	const now = Date.now();
	const recent = (buckets.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
	if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
		buckets.set(userId, recent);
		return false;
	}
	recent.push(now);
	buckets.set(userId, recent);
	return true;
}

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) {
		error(401, 'Unauthorized');
	}

	if (!checkRateLimit(user.id)) {
		error(429, 'Too many classification requests. Try again in a minute.');
	}

	const body = (await request.json()) as { transaction_ids: string[] };
	const ids = body.transaction_ids;
	if (!Array.isArray(ids) || ids.length === 0) {
		error(400, 'Missing transaction_ids');
	}
	if (ids.length > MAX_IDS_PER_REQUEST) {
		error(400, `Too many ids (max ${MAX_IDS_PER_REQUEST})`);
	}

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) {
		error(400, 'User has no group');
	}

	const results = await classifyTransactions(supabase, householdId, ids, user.id);
	return json({ processed: results.length, results });
};
