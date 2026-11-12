import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { classifyTransactions } from '$lib/server/classifier';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { checkPersistentRateLimit } from '$lib/server/rate-limit';
import { LLM_RATE_LIMIT } from '$lib/server/request-guards';

const MAX_IDS_PER_REQUEST = 200;

export const POST: RequestHandler = async ({
	request,
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) {
		error(401, 'Unauthorized');
	}

	if (
		!(await checkPersistentRateLimit(supabaseAdmin, user.id, LLM_RATE_LIMIT))
	) {
		error(429, 'Too many classification requests. Try again in a minute.');
	}

	let body: { transaction_ids?: unknown };
	try {
		body = (await request.json()) as { transaction_ids?: unknown };
	} catch {
		error(400, 'Invalid JSON body');
	}
	const ids = body.transaction_ids;
	if (
		!Array.isArray(ids) ||
		ids.length === 0 ||
		!ids.every((id) => typeof id === 'string')
	) {
		error(400, 'Missing transaction_ids');
	}
	if (ids.length > MAX_IDS_PER_REQUEST) {
		error(400, `Too many ids (max ${MAX_IDS_PER_REQUEST})`);
	}

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) {
		error(400, 'User has no group');
	}

	const results = await classifyTransactions(
		supabase,
		householdId,
		ids as string[],
		user.id
	);
	return json({ processed: results.length, results });
};
