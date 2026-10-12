import type { FxRate } from './fx-rates';

// Valuation of a holding quoted abroad, between the days Wise states it.
//
// The Rende+ fund is accumulating: income never arrives as a payment, the
// quota itself grows a little every day, and Wise shows the annualized pace as
// a "taxa variável". So the dollar quota is carried forward from the last one
// Wise stated — a trade in the statement or a balance read from the app — at
// that declared rate, compounded by calendar day, since a money-market fund
// accrues weekends too. Each new statement or screen re-anchors it, so a rate
// that drifts is corrected rather than compounded.
//
// Reais are a separate factor on top: the dollar quota times the PTAX of the
// day. Only days with a PTAX are written, which keeps the series on the same
// business-day calendar as every other quote.

export interface NativeAnchor {
	date: string;
	nativePrice: number;
}

export interface ForeignQuote {
	date: string;
	nativePrice: number;
	price: number;
}

const DAY_MS = 86400000;

function daysBetween(from: string, to: string): number {
	return Math.round(
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
	);
}

export function accruedNativePrice(
	anchor: NativeAnchor,
	annualPercent: number | null,
	date: string
): number {
	const rate = annualPercent && annualPercent > 0 ? annualPercent / 100 : 0;
	return (
		anchor.nativePrice * (1 + rate) ** (daysBetween(anchor.date, date) / 365)
	);
}

export function foreignQuoteSeries(
	anchor: NativeAnchor,
	annualPercent: number | null,
	fxRates: FxRate[],
	through: string
): ForeignQuote[] {
	return fxRates
		.filter((fx) => fx.date > anchor.date && fx.date <= through)
		.sort((a, b) => (a.date < b.date ? -1 : 1))
		.map((fx) => {
			const nativePrice = accruedNativePrice(anchor, annualPercent, fx.date);
			return { date: fx.date, nativePrice, price: nativePrice * fx.rate };
		});
}
