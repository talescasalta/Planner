import type { CdiRate } from '$lib/server/investment-returns';

// Marcação na curva for bank-issued fixed income (LCA, LCI, CDB).
//
// These papers have no public quote and no secondary market: B3 reports them
// at "Preço Atualizado CURVA", the accrued value, and that is the honest mark
// for something held to maturity. The export gives that price only on the day
// it was generated, though, and says nothing about what the paper pays — the
// Indexador column comes empty — so between imports the price would sit still
// and the holding drops out of every measured period.
//
// So the carry rate is declared once per paper and the price is accrued from
// the last B3 anchor by the market convention: one factor per business day,
// base 252. Each new position import re-anchors on B3's own number, so a rate
// that is slightly off is corrected at the next reconciliation rather than
// compounding.
//
// One convention worth stating plainly, because getting it backwards is easy
// and invisible while the rate is flat: the CDI published for a date is the
// rate of the interbank operations traded on that date, which mature on the
// next business day. So the rate dated D remunerates D → D+1, and the price
// that lands on a business day is carried by the rate of the business day
// before it.

export const BUSINESS_DAYS_PER_YEAR = 252;

export interface CarryRate {
	indexType: string;
	// As typed: 96 means 96% do CDI. For 'pre', the annual rate itself.
	percent: number | null;
	// Annual percentage added on top of the index (CDI + 1.2 stores 1.2).
	spread: number | null;
}

export interface AccrualPoint {
	date: string;
	price: number;
}

// Only what can be computed from the series this app actually holds. IPCA
// needs a price index we do not carry, and declaring a paper we cannot accrue
// is worse than leaving it visibly unmeasured.
export function isAccruable(rate: CarryRate | null): boolean {
	if (!rate) return false;
	if (rate.indexType === 'cdi') return (rate.percent ?? 0) > 0;
	if (rate.indexType === 'pre') return (rate.percent ?? 0) > 0;
	return false;
}

// The daily multiplier for one business day.
//
// BCB SGS series 12 publishes the CDI already as a percent per business day —
// it is the base-252 daily rate, not an annual one — so a percentage of the
// CDI scales that day's rate directly, which is how the market states it. A
// spread is annual and gets its own 252nd root before joining the product.
export function dailyFactor(rate: CarryRate, cdiPercentPerDay: number): number {
	const spread = rate.spread ?? 0;
	const spreadFactor =
		spread > 0 ? (1 + spread / 100) ** (1 / BUSINESS_DAYS_PER_YEAR) : 1;

	if (rate.indexType === 'pre') {
		const annual = rate.percent ?? 0;
		return (1 + annual / 100) ** (1 / BUSINESS_DAYS_PER_YEAR) * spreadFactor;
	}

	// cdi: a share of the day's published rate.
	const share = (rate.percent ?? 0) / 100;
	return (1 + (cdiPercentPerDay / 100) * share) * spreadFactor;
}

export interface AccrualStep {
	// The business day the price lands on.
	date: string;
	// The CDI that carried it there, published on the business day before.
	rate: number;
}

// The business days a price walks through between two dates, each paired with
// the rate that carries it. The CDI series doubles as the business-day
// calendar — BCB publishes a row only for days the market ran — so a prefixado
// paper walks the same days without needing a holiday table of its own.
//
// Pairing each landing day with the *previous* row is the whole point: a rate
// published on Friday remunerates Friday to Monday, so it is Monday's price
// that it carries, not Friday's.
export function accrualSteps(
	cdiRates: CdiRate[],
	from: string,
	through: string
): AccrualStep[] {
	const sorted = [...cdiRates].sort((a, b) => (a.date < b.date ? -1 : 1));
	const steps: AccrualStep[] = [];
	for (let index = 1; index < sorted.length; index += 1) {
		const lands = sorted[index].date;
		if (lands > from && lands <= through) {
			steps.push({ date: lands, rate: sorted[index - 1].rate });
		}
	}
	return steps;
}

// Accrues the anchor price across every business day after it, up to `through`.
export function accrualSeries(
	anchor: AccrualPoint,
	rate: CarryRate,
	cdiRates: CdiRate[],
	through: string
): AccrualPoint[] {
	if (!isAccruable(rate)) return [];

	const points: AccrualPoint[] = [];
	let price = anchor.price;
	for (const step of accrualSteps(cdiRates, anchor.date, through)) {
		price *= dailyFactor(rate, step.rate);
		points.push({ date: step.date, price });
	}
	return points;
}

// The percentage of CDI implied by two anchors of the same paper, found by
// bisection on the one unknown. B3 restates the curve price at every position
// export, so a second import is enough to check a declared rate against what
// the paper actually did — or to recover one that was never declared.
export function impliedCdiPercent(
	first: AccrualPoint,
	second: AccrualPoint,
	cdiRates: CdiRate[]
): number | null {
	if (first.price <= 0 || second.price <= 0 || second.date <= first.date)
		return null;
	const steps = accrualSteps(cdiRates, first.date, second.date);
	if (steps.length === 0) return null;

	const target = second.price / first.price;
	const grown = (percent: number) =>
		steps.reduce(
			(factor, step) =>
				factor *
				dailyFactor({ indexType: 'cdi', percent, spread: 0 }, step.rate),
			1
		);

	// A paper paying nothing cannot have grown, and 300% of CDI is far past
	// anything a bank issues; outside that the answer is not a rate.
	let low = 0;
	let high = 300;
	if (grown(high) < target) return null;
	for (let i = 0; i < 60; i += 1) {
		const middle = (low + high) / 2;
		if (grown(middle) < target) low = middle;
		else high = middle;
	}
	return (low + high) / 2;
}
