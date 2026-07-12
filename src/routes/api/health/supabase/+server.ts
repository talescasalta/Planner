import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ request }) => {
	const cronSecret = env.CRON_SECRET?.trim();
	if (!cronSecret) {
		return json(
			{ ok: false, error: 'Health check is not configured' },
			{ status: 503 }
		);
	}

	const authHeader = request.headers.get('authorization');
	if (authHeader !== `Bearer ${cronSecret}`) {
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

	return json({ ok: true, service: 'supabase' });
};
