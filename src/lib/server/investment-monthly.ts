// How much each holding earned in a given month, and how that compares to the
// CDI of the same month.
//
// A month's gain is not simply "value at the end minus value at the start":
// money put in during the month raises the end value without being return, and
// dividends taken out lower it without being loss. Both are removed first.
//
// Turning that gain into a percentage needs a denominator, and the honest one
// is Modified Dietz: contributions are weighted by how long they stayed
// invested, so R$ 10k that arrived on the 28th does not count as if it had
// worked the whole month. It is the standard the industry uses precisely
// because it needs nothing but the flows and their dates.

import {
	classifyEvent,
	deriveQuantity,
	type EventRow,
	type QuoteRow,
	type SnapshotRow
} from './investment-positions';
import { cdiFactor, type CdiRate } from './investment-returns';
import { computeCostBasis, type TaxAssetRow } from './investment-tax';

export interface MonthWindow {
	month: string; // YYYY-MM
	start: string; // last day of the previous month (the opening mark)
	end: string; // last day of this month, or today for the running month
}

export function monthWindow(month: string, today: string): MonthWindow {
	const [year, monthNumber] = month.split('-').map(Number);
	const start = new Date(Date.UTC(year, monthNumber - 1, 0))
		.toISOString()
		.slice(0, 10);
	const lastDay = new Date(Date.UTC(year, monthNumber, 0))
		.toISOString()
		.slice(0, 10);
	// The current month is measured up to today, not to a date that has not
	// happened yet.
	return { month, start, end: lastDay > today ? today : lastDay };
}

export function recentMonths(today: string, howMany = 2): string[] {
	const [year, monthNumber] = today.slice(0, 7).split('-').map(Number);
	const months: string[] = [];
	for (let back = 0; back < howMany; back++) {
		const date = new Date(Date.UTC(year, monthNumber - 1 - back, 1));
		months.push(date.toISOString().slice(0, 7));
	}
	return months;
}

function priceOnOrBefore(
	assetId: string,
	quotes: QuoteRow[],
	date: string
): number | null {
	let best: QuoteRow | null = null;
	for (const quote of quotes) {
		if (quote.asset_id !== assetId || quote.quote_date > date) continue;
		if (!best || quote.quote_date > best.quote_date) best = quote;
	}
	return best?.price ?? null;
}

// Bank-issued fixed income has no quote at all: B3 prints "-" where the
// closing price would be, so the position file carries a value without a
// price. Deriving the price back from that value is what keeps such holdings
// visible — without it they would weigh zero and quietly shrink both the
// measured patrimony and the amount reported as unmeasured.
function priceAt(
	assetId: string,
	quotes: QuoteRow[],
	snapshots: SnapshotRow[],
	date: string
): number | null {
	const quoted = priceOnOrBefore(assetId, quotes, date);
	if (quoted !== null) return quoted;
	let snapshot: SnapshotRow | null = null;
	for (const row of snapshots) {
		if (row.asset_id !== assetId || row.snapshot_date > date) continue;
		if (!snapshot || row.snapshot_date > snapshot.snapshot_date) snapshot = row;
	}
	if (!snapshot) return null;
	if (snapshot.close_price !== null) return snapshot.close_price;
	return snapshot.quantity !== 0
		? snapshot.net_value / snapshot.quantity
		: null;
}

// True when we hold a price at or after the opening mark. Without one, the
// asset's month cannot be measured at all — carrying an older price forward
// would silently book weeks of market movement into this month.
function hasPriceNear(
	assetId: string,
	quotes: QuoteRow[],
	date: string,
	toleranceDays = 12
): boolean {
	const floor = new Date(
		Date.parse(`${date}T00:00:00Z`) - toleranceDays * 86400000
	)
		.toISOString()
		.slice(0, 10);
	return quotes.some(
		(quote) =>
			quote.asset_id === assetId &&
			quote.quote_date <= date &&
			quote.quote_date >= floor
	);
}

interface DatedFlow {
	date: string;
	amount: number; // positive = money into the portfolio
}

// External flows of one asset inside the window, from the portfolio's side.
function flowsInWindow(
	assetId: string,
	events: EventRow[],
	window: MonthWindow
): DatedFlow[] {
	const flows: DatedFlow[] = [];
	for (const event of events) {
		if (event.asset_id !== assetId || event.source === 'b3_negociacao')
			continue;
		if (event.event_date <= window.start || event.event_date > window.end)
			continue;
		const value = event.total_value ?? 0;
		if (value === 0) continue;
		const effect = classifyEvent(event);
		if (effect === 'quantity') {
			flows.push({
				date: event.event_date,
				amount: event.direction === 'credit' ? value : -value
			});
		} else if (effect === 'income' || effect === 'cost_basis') {
			// Cash leaving the portfolio: it is return already realized, so it is
			// added back to the gain rather than counted as a loss.
			flows.push({ date: event.event_date, amount: -value });
		}
	}
	return flows;
}

function daysBetween(from: string, to: string): number {
	return (
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
	);
}

// Modified Dietz: each contribution counts for the fraction of the period it
// was actually invested.
export function modifiedDietz(
	startValue: number,
	endValue: number,
	flows: DatedFlow[],
	window: MonthWindow
): { gain: number; returnRate: number | null } {
	const netFlow = flows.reduce((sum, flow) => sum + flow.amount, 0);
	const gain = endValue - startValue - netFlow;
	const totalDays = daysBetween(window.start, window.end);
	if (totalDays <= 0) return { gain, returnRate: null };
	let weighted = startValue;
	for (const flow of flows) {
		const remaining = daysBetween(flow.date, window.end) / totalDays;
		weighted += flow.amount * Math.max(0, Math.min(1, remaining));
	}
	// A denominator at or below zero means the position was opened and closed
	// inside the window; the gain in reais is still meaningful, the rate is not.
	return { gain, returnRate: weighted > 0 ? gain / weighted : null };
}

export interface AssetMonthReturn {
	assetId: string;
	startQuantity: number;
	endQuantity: number;
	startValue: number;
	endValue: number;
	netFlow: number;
	gain: number;
	returnRate: number | null;
	percentOfCdi: number | null;
	// Set when the asset has no usable opening price (bank-issued fixed income
	// has no public price at all). Value and flows are still reported.
	unpriced: boolean;
}

export interface MonthReturn {
	month: string;
	start: string;
	end: string;
	cdiRate: number;
	startValue: number;
	endValue: number;
	netFlow: number;
	gain: number;
	returnRate: number | null;
	percentOfCdi: number | null;
	assets: AssetMonthReturn[];
	// What the measurement could not cover. The value is only what we could
	// still mark — a holding with no price anywhere in the period marks as
	// zero — so the count is what tells the reader something is missing.
	unpricedValue: number;
	unpricedCount: number;
	// Last CDI day actually available inside the window. BCB publishes with a
	// lag, so a running month is measured against a short benchmark — which
	// flatters the comparison until the series catches up.
	cdiThrough: string | null;
}

export interface AppliedPoint {
	month: string;
	applied: number; // capital put in and not yet taken out
	gross: number; // what it is worth
}

// The pair a broker shows as "Valor Aplicado" and "Saldo Bruto": the money
// that went in against what it became. Their gap is the accumulated gain, and
// watching it open (or close) says more than either line alone.
//
// Applied is not the sum of purchases: a sale removes the cost of what was
// sold, at the average price paid, which is exactly the cost basis the tax
// engine already tracks.
export interface AppliedSeries {
	points: AppliedPoint[];
	// Holdings left out because they cannot be valued across the whole window,
	// and what they are worth today — so the reader knows what the trend omits.
	excludedCount: number;
	excludedValue: number;
}

export function appliedSeries(
	assets: TaxAssetRow[],
	events: EventRow[],
	snapshots: SnapshotRow[],
	quotes: QuoteRow[],
	months: string[],
	today: string
): AppliedSeries {
	const ordered = [...months].sort((a, b) => a.localeCompare(b));
	const ends = ordered.map((month) => monthWindow(month, today).end);

	// A trend needs the same panel in every month. An asset priced only from
	// the day a position file arrived would enter the chart as a cliff — the
	// patrimony appearing to jump a third in a month — so it is left out of
	// the whole series rather than half of it.
	const eligible: TaxAssetRow[] = [];
	let excludedCount = 0;
	let excludedValue = 0;
	for (const asset of assets) {
		const pricedEverywhere = ends.every((end) => {
			const quantity = deriveQuantity(
				asset.id,
				snapshots,
				events,
				end
			).quantity;
			return (
				quantity === 0 || priceAt(asset.id, quotes, snapshots, end) !== null
			);
		});
		if (pricedEverywhere) {
			eligible.push(asset);
			continue;
		}
		excludedCount++;
		const last = ends.at(-1)!;
		const quantity = deriveQuantity(asset.id, snapshots, events, last).quantity;
		const price = priceAt(asset.id, quotes, snapshots, last);
		if (price !== null) excludedValue += quantity * price;
	}

	const points = ordered.map((month, index) => {
		const end = ends[index];
		let applied = 0;
		let gross = 0;
		for (const asset of eligible) {
			const quantity = deriveQuantity(
				asset.id,
				snapshots,
				events,
				end
			).quantity;
			const upTo = events.filter(
				(event) => event.asset_id === asset.id && event.event_date <= end
			);
			// An override with no date is capital already in place before the
			// window, so it counts from the first month shown.
			const seeded =
				asset.override_date === null || asset.override_date <= end
					? asset
					: { ...asset, override_quantity: null, override_total_cost: null };
			applied += Math.max(0, computeCostBasis(seeded, upTo).cost.totalCost);
			if (quantity === 0) continue;
			const price = priceAt(asset.id, quotes, snapshots, end);
			if (price !== null) gross += quantity * price;
		}
		return { month, applied, gross };
	});

	return { points, excludedCount, excludedValue };
}

export function lastCdiDate(
	rates: CdiRate[],
	window: MonthWindow
): string | null {
	let last: string | null = null;
	for (const rate of rates) {
		if (rate.date <= window.start || rate.date > window.end) continue;
		if (!last || rate.date > last) last = rate.date;
	}
	return last;
}

function percentOfCdi(
	returnRate: number | null,
	cdiRate: number
): number | null {
	if (returnRate === null || cdiRate <= 0) return null;
	return (returnRate / cdiRate) * 100;
}

export function assetMonthReturn(
	assetId: string,
	window: MonthWindow,
	snapshots: SnapshotRow[],
	events: EventRow[],
	quotes: QuoteRow[],
	cdiRate: number
): AssetMonthReturn {
	const startQuantity = deriveQuantity(
		assetId,
		snapshots,
		events,
		window.start
	).quantity;
	const endQuantity = deriveQuantity(
		assetId,
		snapshots,
		events,
		window.end
	).quantity;
	const startPrice = priceOnOrBefore(assetId, quotes, window.start);
	// The end only needs a mark to value the position; the start needs a real
	// quote, since a snapshot taken later would import weeks of movement.
	const endPrice = priceAt(assetId, quotes, snapshots, window.end);
	const flows = flowsInWindow(assetId, events, window);
	const netFlow = flows.reduce((sum, flow) => sum + flow.amount, 0);

	// A position opened during the month starts at zero by definition, so it
	// needs no opening price — only one at the end.
	const openedThisMonth = startQuantity === 0;
	const measurable =
		endPrice !== null &&
		(openedThisMonth ||
			(startPrice !== null && hasPriceNear(assetId, quotes, window.start)));
	const startValue = startPrice === null ? 0 : startQuantity * startPrice;
	const endValue = endPrice === null ? 0 : endQuantity * endPrice;

	if (!measurable) {
		return {
			assetId,
			startQuantity,
			endQuantity,
			startValue,
			endValue,
			netFlow,
			gain: 0,
			returnRate: null,
			percentOfCdi: null,
			unpriced: true
		};
	}

	const { gain, returnRate } = modifiedDietz(
		startValue,
		endValue,
		flows,
		window
	);
	return {
		assetId,
		startQuantity,
		endQuantity,
		startValue,
		endValue,
		netFlow,
		gain,
		returnRate,
		percentOfCdi: percentOfCdi(returnRate, cdiRate),
		unpriced: false
	};
}

export function monthReturn(
	assetIds: string[],
	month: string,
	today: string,
	snapshots: SnapshotRow[],
	events: EventRow[],
	quotes: QuoteRow[],
	rates: CdiRate[]
): MonthReturn {
	const window = monthWindow(month, today);
	const cdiRate = cdiFactor(rates, window.start, window.end) - 1;
	const assets = assetIds.map((assetId) =>
		assetMonthReturn(assetId, window, snapshots, events, quotes, cdiRate)
	);

	const priced = assets.filter((asset) => !asset.unpriced);
	// Only holdings actually present in the period count as gaps, and the test
	// is the position rather than the value: an LCA with no price at all still
	// has quotas, and is exactly the kind of gap worth declaring. An asset long
	// gone is not something the reader is missing.
	const unpriced = assets.filter(
		(asset) =>
			asset.unpriced && (asset.startQuantity > 0 || asset.endQuantity > 0)
	);
	const startValue = priced.reduce((sum, a) => sum + a.startValue, 0);
	const endValue = priced.reduce((sum, a) => sum + a.endValue, 0);
	const netFlow = priced.reduce((sum, a) => sum + a.netFlow, 0);
	const gain = priced.reduce((sum, a) => sum + a.gain, 0);
	// The portfolio rate uses the summed values rather than averaging the
	// assets': a 30% gain on R$ 100 must not weigh like one on R$ 100k.
	const denominator = startValue + netFlow / 2;
	const returnRate = denominator > 0 ? gain / denominator : null;

	return {
		month,
		start: window.start,
		end: window.end,
		cdiRate,
		startValue,
		endValue,
		netFlow,
		gain,
		returnRate,
		percentOfCdi: percentOfCdi(returnRate, cdiRate),
		assets: assets.sort((a, b) => b.gain - a.gain),
		unpricedValue: unpriced.reduce((sum, asset) => sum + asset.endValue, 0),
		unpricedCount: unpriced.length,
		cdiThrough: lastCdiDate(rates, window)
	};
}
