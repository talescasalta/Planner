import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { refreshInvestmentQuotes } from '$lib/server/investment-quotes';

// Vercel cron (weekday evenings, after B3 close). Same auth contract as
// /api/health/supabase: nothing runs without the exact CRON_SECRET bearer.
export const GET: RequestHandler = async ({ request }) => {
	const cronSecret = env.CRON_SECRET?.trim();
	if (!cronSecret) {
		return json(
			{ ok: false, error: 'Cron is not configured' },
			{ status: 503 }
		);
	}

	const authHeader = request.headers.get('authorization');
	if (authHeader !== `Bearer ${cronSecret}`) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}

	const summary = await refreshInvestmentQuotes();
	if (summary.errors.length > 0) {
		console.error('[cron/investment-quotes]', summary.errors);
	}
	return json({ ok: summary.errors.length === 0, ...summary });
};
