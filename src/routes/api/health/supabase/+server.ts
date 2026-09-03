import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { bearerMatches } from '$lib/server/request-guards';
import { supabaseAdmin } from '$lib/server/supabase';
import { llmConfigSummary } from '$lib/server/llm';

export const GET: RequestHandler = async ({ request }) => {
	const cronSecret = env.CRON_SECRET?.trim();
	if (!cronSecret) {
		return json(
			{ ok: false, error: 'Health check is not configured' },
			{ status: 503 }
		);
	}

	if (!bearerMatches(request.headers.get('authorization'), cronSecret)) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}

	const { error } = await supabaseAdmin
		.from('households')
		.select('id')
		.limit(1);
	if (error) {
		console.error('[health/supabase] Supabase health check failed', error);
		return json(
			{ ok: false, error: 'Supabase health check failed' },
			{ status: 500 }
		);
	}

	// Reported here rather than anywhere public: this route already requires
	// the cron secret, and the effective model is otherwise invisible without
	// reading the deployment's environment by hand.
	return json({ ok: true, service: 'supabase', llm: llmConfigSummary() });
};
