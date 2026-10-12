import { supabaseAdmin } from '$lib/server/supabase';
import { brazilToday } from './brazil-date';
import { fetchSgsSeries } from './investment-cdi';
import { selectAll } from '$lib/server/supabase-paging';

// PTAX de venda from the Banco Central SGS API — the same open, unauthenticated
// source as the CDI series, one series per currency. PTAX is the rate the
// Receita uses for anything converted from abroad, so it is also the honest
// mark for a foreign balance, even if the broker's own rate differs by a few
// cents.

export type ForeignCurrency = 'USD' | 'EUR' | 'GBP';

const SGS_SERIES: Record<ForeignCurrency, number> = {
	USD: 1,
	EUR: 21620,
	GBP: 21624
};

export function isForeignCurrency(value: string): value is ForeignCurrency {
	return Object.hasOwn(SGS_SERIES, value);
}

export interface FxRate {
	date: string;
	rate: number;
}

function nextDay(iso: string): string {
	return new Date(Date.parse(`${iso}T00:00:00Z`) + 86400000)
		.toISOString()
		.slice(0, 10);
}

export async function fetchFxRates(
	currency: ForeignCurrency,
	from: string,
	to: string,
	fetcher: typeof fetch = fetch
): Promise<FxRate[]> {
	const rows = await fetchSgsSeries(SGS_SERIES[currency], from, to, fetcher);
	return rows.filter((row) => row.rate > 0);
}

async function storedEdge(
	currency: ForeignCurrency,
	ascending: boolean
): Promise<string | null> {
	const { data, error } = await supabaseAdmin
		.from('fx_daily_rates')
		.select('rate_date')
		.eq('currency', currency)
		.order('rate_date', { ascending })
		.limit(1)
		.maybeSingle();
	if (error) throw new Error(error.message);
	return (data?.rate_date as string | undefined) ?? null;
}

// Where a currency's series needs filling from: the day after the newest row
// when the stored series already reaches back to `since`, else `since` itself.
async function syncStart(
	currency: ForeignCurrency,
	since: string
): Promise<string> {
	const oldest = await storedEdge(currency, true);
	if (!oldest || oldest > since) return since;
	const newest = await storedEdge(currency, false);
	return newest ? nextDay(newest) : since;
}

async function syncCurrency(
	currency: ForeignCurrency,
	since: string,
	today: string,
	fetcher: typeof fetch
): Promise<number> {
	const from = await syncStart(currency, since);
	if (from > today) return 0;
	const rates = await fetchFxRates(currency, from, today, fetcher);
	if (rates.length === 0) return 0;
	const { count, error } = await supabaseAdmin.from('fx_daily_rates').upsert(
		rates.map((rate) => ({ currency, rate_date: rate.date, rate: rate.rate })),
		{ onConflict: 'currency,rate_date', ignoreDuplicates: true, count: 'exact' }
	);
	if (error) throw new Error(error.message);
	return count ?? 0;
}

// Tops up each currency from its newest stored day, or from `since` when the
// series is empty or does not reach that far back yet. Published rates never
// change, so existing rows are left alone.
export async function syncFxRates(
	currencies: ForeignCurrency[],
	since: string,
	fetcher: typeof fetch = fetch
): Promise<{ inserted: number; errors: string[] }> {
	const today = brazilToday();
	let inserted = 0;
	const errors: string[] = [];
	for (const currency of new Set(currencies)) {
		try {
			inserted += await syncCurrency(currency, since, today, fetcher);
		} catch (error) {
			errors.push(`ptax ${currency}: ${String((error as Error).message)}`);
		}
	}
	return { inserted, errors };
}

export async function loadFxRates(
	currency: ForeignCurrency,
	from: string,
	to: string
): Promise<FxRate[]> {
	const rows = await selectAll<{ rate_date: string; rate: number }>(
		'fx_daily_rates',
		(pageFrom, pageTo) =>
			supabaseAdmin
				.from('fx_daily_rates')
				.select('rate_date, rate')
				.eq('currency', currency)
				.gte('rate_date', from)
				.lte('rate_date', to)
				.order('rate_date')
				.range(pageFrom, pageTo)
	);
	return rows.map((row) => ({ date: row.rate_date, rate: Number(row.rate) }));
}

// A week before the first date asked for, so a trade on a Monday holiday
// still finds the PTAX of the business day before.
function fxWindowStart(date: string): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) - 7 * 86400000)
		.toISOString()
		.slice(0, 10);
}

export async function loadFxFor(
	currencies: ForeignCurrency[],
	since: string,
	through: string
): Promise<{ rates: Map<ForeignCurrency, FxRate[]>; errors: string[] }> {
	const start = fxWindowStart(since);
	const { errors } = await syncFxRates(currencies, start);
	const rates = new Map<ForeignCurrency, FxRate[]>();
	for (const currency of new Set(currencies))
		rates.set(currency, await loadFxRates(currency, start, through));
	return { rates, errors };
}

// The PTAX in force on a date: that day's, or the last business day's before
// it — a Saturday trade is converted at Friday's rate.
export function fxOn(rates: FxRate[], date: string): number | null {
	let best: FxRate | null = null;
	for (const rate of rates) {
		if (rate.date > date) continue;
		if (!best || rate.date > best.date) best = rate;
	}
	return best?.rate ?? null;
}
