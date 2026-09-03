import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import {
	deriveQuantity,
	latestPrice,
	type EventRow,
	type QuoteRow,
	type SnapshotRow
} from '$lib/server/investment-positions';
import { loadCdiRates } from '$lib/server/investment-cdi';
import { monthReturn, recentMonths } from '$lib/server/investment-monthly';
import type { TaxBucket } from '$lib/server/investment-assets';

// The four tables every investment view reads, loaded once per request with
// the user's own client so RLS stays the authority, and the derived numbers
// the section header shows on every tab.

export interface InvestmentAssetRow {
	id: string;
	owner_user_id: string;
	asset_class: string;
	ticker: string | null;
	name: string;
	product_key: string;
	tax_bucket: TaxBucket;
	cnpj: string | null;
	override_quantity: number | null;
	override_total_cost: number | null;
	override_date: string | null;
	issue_date: string | null;
	maturity_date: string | null;
	index_type: string | null;
	index_percent: number | null;
	index_spread: number | null;
}

export interface InvestmentRows {
	assets: InvestmentAssetRow[];
	snapshots: SnapshotRow[];
	events: EventRow[];
	quotes: QuoteRow[];
}

const ASSET_COLUMNS =
	'id, owner_user_id, asset_class, ticker, name, product_key, tax_bucket, cnpj, override_quantity, override_total_cost, override_date, issue_date, maturity_date, index_type, index_percent, index_spread';

// The layout load and the page load run in parallel on the same request and
// want the same four tables. Keying the in-flight promise by the request's own
// Supabase client (hooks builds one per request) lets the second caller join
// the first instead of repeating the reads; the entry dies with the client.
const inFlight = new WeakMap<
	SupabaseClient<Database>,
	Map<string, Promise<InvestmentRows>>
>();

export function loadInvestmentRows(
	supabase: SupabaseClient<Database>,
	householdId: string,
	assetIds?: string[]
): Promise<InvestmentRows> {
	// Only the whole-household read is shared; a by-id read is a different set.
	if (assetIds) return fetchInvestmentRows(supabase, householdId, assetIds);

	const perClient = inFlight.get(supabase) ?? new Map();
	inFlight.set(supabase, perClient);
	const cached = perClient.get(householdId);
	if (cached) return cached;

	const pending = fetchInvestmentRows(supabase, householdId);
	perClient.set(householdId, pending);
	return pending;
}

async function fetchInvestmentRows(
	supabase: SupabaseClient<Database>,
	householdId: string,
	assetIds?: string[]
): Promise<InvestmentRows> {
	const assets = supabase
		.from('investment_assets')
		.select(ASSET_COLUMNS)
		.eq('household_id', householdId);
	const snapshots = supabase
		.from('investment_snapshots')
		.select('asset_id, snapshot_date, quantity, close_price, net_value')
		.eq('household_id', householdId);
	const events = supabase
		.from('investment_events')
		.select(
			'asset_id, event_date, event_type, direction, quantity, unit_price, total_value, source'
		)
		.eq('household_id', householdId);
	const quotes = supabase
		.from('investment_quotes')
		.select('asset_id, quote_date, price, source')
		.eq('household_id', householdId);

	const [assetsRes, snapshotsRes, eventsRes, quotesRes] = await Promise.all(
		assetIds
			? [
					assets.in('id', assetIds),
					snapshots.in('asset_id', assetIds),
					events.in('asset_id', assetIds),
					quotes.in('asset_id', assetIds)
				]
			: [assets, snapshots, events, quotes]
	);

	return {
		assets: (assetsRes.data ?? []) as InvestmentAssetRow[],
		snapshots: (snapshotsRes.data ?? []) as SnapshotRow[],
		events: (eventsRes.data ?? []) as EventRow[],
		quotes: (quotesRes.data ?? []) as QuoteRow[]
	};
}

export interface PositionValue {
	assetId: string;
	quantity: number;
	price: number | null;
	priceDate: string | null;
	value: number;
	unknownEventTypes: string[];
}

// Quantity from the last snapshot plus later events, valued at the freshest
// price we have. Zero when no price exists — the caller decides how to flag it.
export function valuePositions(rows: InvestmentRows): PositionValue[] {
	return rows.assets.map((asset) => {
		const derived = deriveQuantity(asset.id, rows.snapshots, rows.events);
		const price = latestPrice(asset.id, rows.quotes, rows.snapshots);
		return {
			assetId: asset.id,
			quantity: derived.quantity,
			price: price?.price ?? null,
			priceDate: price?.date ?? null,
			value: price ? derived.quantity * price.price : 0,
			unknownEventTypes: derived.unknownEventTypes
		};
	});
}

// Newest date the cron actually priced something; snapshot-sourced quotes are
// the B3 file's own date and say nothing about freshness.
export function lastQuoteDate(quotes: QuoteRow[]): string | null {
	return quotes.reduce<string | null>(
		(latest, quote) =>
			quote.source !== 'snapshot' && (!latest || quote.quote_date > latest)
				? quote.quote_date
				: latest,
		null
	);
}

export function lastSnapshotDate(snapshots: SnapshotRow[]): string | null {
	return snapshots.reduce<string | null>(
		(latest, snapshot) =>
			!latest || snapshot.snapshot_date > latest
				? snapshot.snapshot_date
				: latest,
		null
	);
}

export interface InvestmentOverview {
	hasData: boolean;
	totalValue: number;
	positionsCount: number;
	month: string;
	monthGain: number;
	monthReturnRate: number | null;
	monthPercentOfCdi: number | null;
	monthUnpricedCount: number;
	lastQuoteDate: string | null;
	lastSnapshotDate: string | null;
	cdiThrough: string | null;
	monthEnd: string;
}

export const EMPTY_OVERVIEW: InvestmentOverview = {
	hasData: false,
	totalValue: 0,
	positionsCount: 0,
	month: '',
	monthGain: 0,
	monthReturnRate: null,
	monthPercentOfCdi: null,
	monthUnpricedCount: 0,
	lastQuoteDate: null,
	lastSnapshotDate: null,
	cdiThrough: null,
	monthEnd: ''
};

// The strip under the tabs: total, how the running month is going, and how
// fresh the inputs are. Computed from the same functions the pages use, so the
// header never disagrees with the tab below it.
export async function buildOverview(
	rows: InvestmentRows,
	today: string
): Promise<InvestmentOverview> {
	const positions = valuePositions(rows).filter((p) => p.quantity > 0);
	if (positions.length === 0) return EMPTY_OVERVIEW;

	const [month] = recentMonths(today, 1);
	const rates = await loadCdiRates(`${month}-01`, today);
	const current = monthReturn(
		rows.assets.map((asset) => asset.id),
		month,
		today,
		rows.snapshots,
		rows.events,
		rows.quotes,
		rates
	);

	return {
		hasData: true,
		totalValue: positions.reduce((sum, p) => sum + p.value, 0),
		positionsCount: positions.length,
		month,
		monthGain: current.gain,
		monthReturnRate: current.returnRate,
		monthPercentOfCdi: current.percentOfCdi,
		monthUnpricedCount: current.unpricedCount,
		lastQuoteDate: lastQuoteDate(rows.quotes),
		lastSnapshotDate: lastSnapshotDate(rows.snapshots),
		cdiThrough: current.cdiThrough,
		monthEnd: current.end
	};
}
