import { supabaseAdmin } from '$lib/server/supabase';
import { selectAll } from '$lib/server/supabase-paging';
import type { CdiRate } from './investment-returns';

// CDI comes from the Banco Central's open SGS API (series 12, "taxa CDI ao
// dia"). Free, unauthenticated, and complete back to 1986 — the one piece of
// this feature that needs no workaround.

const SGS_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados';

function toBrDate(iso: string): string {
	const [year, month, day] = iso.split('-');
	return `${day}/${month}/${year}`;
}

export function parseSgsRows(body: unknown): CdiRate[] {
	if (!Array.isArray(body)) return [];
	const rates: CdiRate[] = [];
	for (const row of body) {
		const date = (row as { data?: unknown }).data;
		const value = (row as { valor?: unknown }).valor;
		if (typeof date !== 'string' || typeof value !== 'string') continue;
		const match = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
		const rate = Number(value);
		if (!match || !Number.isFinite(rate)) continue;
		rates.push({ date: `${match[3]}-${match[2]}-${match[1]}`, rate });
	}
	return rates;
}

export async function fetchCdiRates(
	from: string,
	to: string,
	fetcher: typeof fetch = fetch
): Promise<CdiRate[]> {
	const url = `${SGS_URL}?formato=json&dataInicial=${toBrDate(from)}&dataFinal=${toBrDate(to)}`;
	const response = await fetcher(url, {
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new Error(`BCB SGS respondeu ${response.status}`);
	return parseSgsRows(await response.json());
}

// Only fetches what is missing: the series is immutable once published, so a
// daily run asks for the handful of days since the newest stored rate.
export async function syncCdiRates(
	fetcher: typeof fetch = fetch
): Promise<{ inserted: number; error?: string }> {
	const today = new Date().toISOString().slice(0, 10);
	const { data: newest, error: selectError } = await supabaseAdmin
		.from('cdi_daily_rates')
		.select('rate_date')
		.order('rate_date', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (selectError) return { inserted: 0, error: selectError.message };

	// First run backfills a decade so the history covers the event stream that
	// starts in 2019; later runs only top up.
	const from = newest?.rate_date
		? new Date(Date.parse(`${newest.rate_date}T00:00:00Z`) + 86400000)
				.toISOString()
				.slice(0, 10)
		: '2015-01-01';
	if (from > today) return { inserted: 0 };

	try {
		const rates = await fetchCdiRates(from, today, fetcher);
		if (rates.length === 0) return { inserted: 0 };
		const { data, error } = await supabaseAdmin
			.from('cdi_daily_rates')
			.upsert(
				rates.map((rate) => ({ rate_date: rate.date, rate: rate.rate })),
				{ onConflict: 'rate_date', ignoreDuplicates: true }
			)
			.select('rate_date');
		if (error) return { inserted: 0, error: error.message };
		return { inserted: data?.length ?? 0 };
	} catch (error) {
		return { inserted: 0, error: String((error as Error).message) };
	}
}

export async function loadCdiRates(
	from: string,
	to: string
): Promise<CdiRate[]> {
	// rate_date is the primary key, so ordering by it makes the ranges stable.
	const rows = await selectAll<{ rate_date: string; rate: number }>(
		'cdi_daily_rates',
		(pageFrom, pageTo) =>
			supabaseAdmin
				.from('cdi_daily_rates')
				.select('rate_date, rate')
				.gte('rate_date', from)
				.lte('rate_date', to)
				.order('rate_date')
				.range(pageFrom, pageTo)
	);
	return rows.map((row) => ({
		date: row.rate_date,
		rate: Number(row.rate)
	}));
}
