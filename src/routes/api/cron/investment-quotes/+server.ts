import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { refreshInvestmentQuotes } from '$lib/server/investment-quotes';
import { syncCdiRates } from '$lib/server/investment-cdi';

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

	// Quotes build the portfolio's value history; the CDI series is what that
	// history gets measured against. Both are idempotent per day.
	const [summary, cdi] = await Promise.all([
		refreshInvestmentQuotes(),
		syncCdiRates()
	]);
	const errors = [
		...summary.errors,
		...(cdi.error ? [`cdi: ${cdi.error}`] : [])
	];
	if (errors.length > 0) {
		console.error('[cron/investment-quotes]', errors);
	}
	return json({
		ok: errors.length === 0,
		...summary,
		cdiRatesInserted: cdi.inserted,
		errors
	});
};
