import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { bearerMatches } from '$lib/server/request-guards';
import { refreshInvestmentQuotes } from '$lib/server/investment-quotes';
import { syncCdiRates } from '$lib/server/investment-cdi';
import { backfillQuoteHistory } from '$lib/server/investment-history';
import { syncFundRegistry } from '$lib/server/investment-registry';

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

	if (!bearerMatches(request.headers.get('authorization'), cronSecret)) {
		return json({ ok: false, error: 'Unauthorized' }, { status: 401 });
	}

	// Quotes build the portfolio's value history; the CDI series is what that
	// history gets measured against. Both are idempotent per day.
	const [summary, cdi] = await Promise.all([
		refreshInvestmentQuotes(),
		syncCdiRates()
	]);

	// Monthly returns need the closing price of the previous month, and a newly
	// imported asset arrives with none. Backfilling a short window each run
	// fills those in; existing rows are never overwritten, so it settles into a
	// no-op once the history is complete.
	const since = new Date(Date.now() - 120 * 86400000)
		.toISOString()
		.slice(0, 10);
	const backfill = await backfillQuoteHistory(since);

	// The searchable copy of the CVM registry: what lets a fund be found by the
	// name a broker screenshot shows, without ever composing a CNPJ.
	const registry = await syncFundRegistry();

	const errors = [
		...summary.errors,
		...(cdi.error ? [`cdi: ${cdi.error}`] : []),
		...backfill.errors,
		...(registry.error ? [`registry: ${registry.error}`] : [])
	];
	if (errors.length > 0) {
		console.error('[cron/investment-quotes]', errors);
	}
	return json({
		ok: errors.length === 0,
		...summary,
		cdiRatesInserted: cdi.inserted,
		historyInserted: backfill.inserted,
		registryRows: registry.upserted,
		errors
	});
};
