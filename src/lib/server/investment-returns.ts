// Portfolio return measured against the CDI.
//
// Two different questions, two different methods:
//
// 1. "How has my portfolio done since I started?" — money-weighted return
//    (XIRR) over every external cash flow plus today's value. Needs no
//    historical valuations, so it works with the single snapshot B3 gives us.
// 2. "How am I doing versus CDI over time?" — time-weighted return chained
//    from daily valuations the cron records from now on, which neutralizes
//    the effect of contribution timing (the only fair benchmark comparison).
//
// Both express the result the way the Brazilian market does: the portfolio's
// annualized rate as a percentage of the CDI's annualized rate.

import {
	classifyEvent,
	deriveQuantity,
	type EventRow,
	type QuoteRow,
	type SnapshotRow
} from './investment-positions';

const DAYS_PER_YEAR = 365;
// Rates outside this band are not real portfolio returns — they mean the cash
// flows are broken (a missing entry cost, a duplicated sale). Better to report
// "não foi possível calcular" than a plausible-looking wrong number.
const MIN_RATE = -0.9999;
const MAX_RATE = 10;

export interface CashFlow {
	date: string; // ISO
	// Negative = investor put money in, positive = investor took money out.
	amount: number;
}

function yearsBetween(from: string, to: string): number {
	const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
	return ms / (1000 * 60 * 60 * 24 * DAYS_PER_YEAR);
}

function netPresentValue(
	flows: CashFlow[],
	rate: number,
	origin: string
): number {
	let npv = 0;
	for (const flow of flows) {
		npv += flow.amount / Math.pow(1 + rate, yearsBetween(origin, flow.date));
	}
	return npv;
}

// Annualized money-weighted return. Bisection rather than Newton-Raphson: it
// cannot diverge, and with a bracket this wide the extra iterations are free.
export function xirr(flows: CashFlow[]): number | null {
	if (flows.length < 2) return null;
	const sorted = [...flows].sort((a, b) => a.date.localeCompare(b.date));
	const origin = sorted[0].date;
	const hasInflow = sorted.some((flow) => flow.amount < 0);
	const hasOutflow = sorted.some((flow) => flow.amount > 0);
	// Without money going both ways there is no rate that zeroes the NPV.
	if (!hasInflow || !hasOutflow) return null;

	let low = MIN_RATE;
	let high = MAX_RATE;
	let npvLow = netPresentValue(sorted, low, origin);
	const npvHigh = netPresentValue(sorted, high, origin);
	if (Number.isNaN(npvLow) || Number.isNaN(npvHigh)) return null;
	if (npvLow * npvHigh > 0) return null; // no root inside the plausible band

	for (let i = 0; i < 200; i++) {
		const mid = (low + high) / 2;
		const npvMid = netPresentValue(sorted, mid, origin);
		if (Math.abs(npvMid) < 1e-9 || high - low < 1e-12) return mid;
		if (npvMid * npvLow < 0) {
			high = mid;
		} else {
			low = mid;
			npvLow = npvMid;
		}
	}
	return (low + high) / 2;
}

export interface AssetFlowSummary {
	flows: CashFlow[];
	// Assets with no accountable entry cost, left out of the calculation and
	// reported so the coverage of the result is visible.
	excludedAssetIds: string[];
}

export interface ReturnAssetRow {
	id: string;
	override_quantity: number | null;
	override_total_cost: number | null;
	override_date: string | null;
}

// Broker migrations: real quantity arrives, B3 records no amount for it.
const BROKER_TRANSFER = /transfer/i;

function isAcquisition(event: EventRow): boolean {
	return (
		event.source !== 'b3_negociacao' &&
		event.direction === 'credit' &&
		classifyEvent(event) === 'quantity'
	);
}

// An asset can only be measured if every unit of it has a known cost. Two
// distinct ways B3 breaks that, and an asset fails on either one:
//
//  - no priced acquisition anywhere (a holding older than the movimentação
//    history, so it exists only in the position file), or
//  - a broker transfer credited with no amount, which leaves part of the
//    position free even when other purchases are properly recorded.
//
// Both would book the holding as pure gain. A manual cost basis is exactly the
// missing number, so it clears either failure.
function assetsWithoutEntryCost(
	assets: ReturnAssetRow[],
	events: EventRow[]
): Set<string> {
	const acquiredForAPrice = new Set<string>();
	const arrivedFree = new Set<string>();
	for (const event of events) {
		if (!isAcquisition(event)) continue;
		if ((event.total_value ?? 0) > 0) {
			acquiredForAPrice.add(event.asset_id);
		} else if (BROKER_TRANSFER.test(event.event_type)) {
			arrivedFree.add(event.asset_id);
		}
	}
	const excluded = new Set<string>();
	for (const asset of assets) {
		const hasOverride =
			asset.override_quantity !== null && asset.override_total_cost !== null;
		if (hasOverride) continue;
		if (!acquiredForAPrice.has(asset.id) || arrivedFree.has(asset.id)) {
			excluded.add(asset.id);
		}
	}
	return excluded;
}

function flowForEvent(event: EventRow): CashFlow | null {
	const value = event.total_value ?? 0;
	if (value === 0) return null;
	const effect = classifyEvent(event);
	if (effect === 'quantity') {
		// Buying consumes cash; selling and redeeming return it.
		return {
			date: event.event_date,
			amount: event.direction === 'credit' ? -value : value
		};
	}
	if (effect === 'income' || effect === 'cost_basis') {
		return { date: event.event_date, amount: value };
	}
	if (effect === 'fee') return { date: event.event_date, amount: -value };
	return null;
}

// Turns the event stream into external cash flows: buying is money leaving the
// investor, selling/redeeming/receiving income is money coming back.
export function buildCashFlows(
	assets: ReturnAssetRow[],
	events: EventRow[],
	currentValueByAsset: Map<string, number>,
	valuationDate: string
): AssetFlowSummary {
	const excluded = assetsWithoutEntryCost(assets, events);
	const flows: CashFlow[] = [];

	for (const asset of assets) {
		if (asset.override_quantity === null || asset.override_total_cost === null)
			continue;
		flows.push({
			date: asset.override_date ?? '2000-01-01',
			amount: -asset.override_total_cost
		});
	}

	for (const event of events) {
		// Settlements in movimentação already cover every trade.
		if (event.source === 'b3_negociacao') continue;
		if (excluded.has(event.asset_id)) continue;
		const flow = flowForEvent(event);
		if (flow) flows.push(flow);
	}

	let finalValue = 0;
	for (const [assetId, value] of currentValueByAsset) {
		if (!excluded.has(assetId)) finalValue += value;
	}
	if (finalValue > 0) flows.push({ date: valuationDate, amount: finalValue });

	return { flows, excludedAssetIds: [...excluded] };
}

export interface CdiRate {
	date: string; // ISO
	rate: number; // daily percentage, as published by BCB SGS 12 (e.g. 0.05166)
}

// Compounded CDI factor over [from, to]. BCB publishes the rate in percent per
// business day, and the series only carries business days, so multiplying the
// listed days is the whole calculation.
export function cdiFactor(rates: CdiRate[], from: string, to: string): number {
	let factor = 1;
	for (const rate of rates) {
		if (rate.date <= from || rate.date > to) continue;
		factor *= 1 + rate.rate / 100;
	}
	return factor;
}

export function annualize(
	factor: number,
	from: string,
	to: string
): number | null {
	const years = yearsBetween(from, to);
	if (years <= 0 || factor <= 0) return null;
	return Math.pow(factor, 1 / years) - 1;
}

export interface CdiComparison {
	from: string;
	to: string;
	portfolioAnnual: number;
	cdiAnnual: number;
	// Portfolio rate as a percentage of the CDI rate — the market convention.
	// Null when CDI is zero or negative, where the ratio means nothing.
	percentOfCdi: number | null;
}

export function compareToCdi(
	portfolioAnnual: number,
	rates: CdiRate[],
	from: string,
	to: string
): CdiComparison | null {
	const cdiAnnual = annualize(cdiFactor(rates, from, to), from, to);
	if (cdiAnnual === null) return null;
	return {
		from,
		to,
		portfolioAnnual,
		cdiAnnual,
		percentOfCdi: cdiAnnual > 0 ? (portfolioAnnual / cdiAnnual) * 100 : null
	};
}

export interface ValuationPoint {
	date: string;
	totalValue: number;
	netFlow: number; // external money in (+) or out (-) on that date
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

// External cash flow of a single day, from the portfolio's point of view:
// a purchase brings value in (+), a sale or an income payment takes it out (-).
// Opposite sign to CashFlow, which is written from the investor's side.
export function netFlowOn(events: EventRow[], date: string): number {
	let flow = 0;
	for (const event of events) {
		if (event.event_date !== date || event.source === 'b3_negociacao') continue;
		const value = event.total_value ?? 0;
		if (value === 0) continue;
		const effect = classifyEvent(event);
		if (effect === 'quantity') {
			flow += event.direction === 'credit' ? value : -value;
		} else if (effect === 'income' || effect === 'cost_basis') {
			flow -= value;
		}
	}
	return flow;
}

// Rebuilds what the portfolio was worth on each date we hold quotes for.
// Derived rather than stored: movimentação arrives up to a month late, and a
// stored value would freeze the wrong number until someone recomputed it.
export function valuationSeries(
	assetIds: string[],
	snapshots: SnapshotRow[],
	events: EventRow[],
	quotes: QuoteRow[],
	dates: string[]
): ValuationPoint[] {
	return [...dates]
		.sort((a, b) => a.localeCompare(b))
		.map((date) => {
			let totalValue = 0;
			for (const assetId of assetIds) {
				const quantity = deriveQuantity(
					assetId,
					snapshots,
					events,
					date
				).quantity;
				if (quantity === 0) continue;
				const price = priceOnOrBefore(assetId, quotes, date);
				if (price === null) continue;
				totalValue += quantity * price;
			}
			return { date, totalValue, netFlow: netFlowOn(events, date) };
		});
}

export interface TwrPoint {
	date: string;
	portfolioIndex: number; // base 100 at the first point
	cdiIndex: number;
}

// Time-weighted return: each day's factor removes the cash that arrived that
// day, so contributions neither help nor hurt the measured performance. This
// is what makes the comparison against CDI fair.
export function twrSeries(
	valuations: ValuationPoint[],
	rates: CdiRate[]
): TwrPoint[] {
	const sorted = [...valuations].sort((a, b) => a.date.localeCompare(b.date));
	if (sorted.length === 0) return [];
	const points: TwrPoint[] = [
		{ date: sorted[0].date, portfolioIndex: 100, cdiIndex: 100 }
	];
	let portfolioIndex = 100;
	let cdiIndex = 100;
	for (let i = 1; i < sorted.length; i++) {
		const previous = sorted[i - 1];
		const current = sorted[i];
		if (previous.totalValue > 0) {
			const factor =
				(current.totalValue - current.netFlow) / previous.totalValue;
			if (factor > 0) portfolioIndex *= factor;
		}
		cdiIndex *= cdiFactor(rates, previous.date, current.date);
		points.push({ date: current.date, portfolioIndex, cdiIndex });
	}
	return points;
}
