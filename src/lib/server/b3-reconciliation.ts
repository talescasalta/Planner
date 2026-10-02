import { foldForMatch } from './own-names';
import { shiftIsoDate } from './import-duplicates';

// The broker credits what B3 paid (dividends, interest, amortization) as a
// bare "Crédito em conta", often bundling several payment dates into one
// deposit. The investments module already knows each payment from the B3
// movimentação, so a credit whose amount equals the sum of consecutive payment
// dates is that income, and one that lands right after a redemption is
// probably the redemption's proceeds.

export interface B3Event {
	event_date: string;
	event_type: string;
	direction: string;
	total_value: number | string | null;
	source: string;
	raw_product?: string;
}

export type CreditMatch =
	| { kind: 'investment_income'; eventDate: string; count: number }
	| { kind: 'redemption_likely' }
	| null;

// Payments are bundled over a week or so (Sep 8-15 became one Sep 16 deposit).
const INCOME_WINDOW_DAYS = 10;
// A redemption's proceeds arrive within days of the redemption itself.
const REDEMPTION_WINDOW_DAYS = 5;
const MIN_REDEMPTION_CREDIT = 1000;
const TOLERANCE_CENTS = 1;

const INCOME_TYPES = new Set([
	'rendimento',
	'dividendo',
	'juros',
	'juros sobre capital proprio',
	'amortizacao'
]);
const REDEMPTION_TYPE = /resgate|venda|vencimento/;

function cents(value: number | string): number {
	return Math.round(Number(value) * 100);
}

// The label Nubank gives a deposit it cannot attribute to a counterparty. Only
// these are matched: a salary or a Pix with a name must never be relabeled
// because its amount happens to equal a sum of dividends.
export function isGenericBankCredit(description: string): boolean {
	return foldForMatch(description).startsWith('credito em conta');
}

function isIncomeEvent(event: B3Event): boolean {
	return (
		event.source === 'b3_movimentacao' &&
		event.direction === 'credit' &&
		event.total_value !== null &&
		INCOME_TYPES.has(foldForMatch(event.event_type))
	);
}

function incomeByDate(events: B3Event[], from: string, to: string) {
	const byDate = new Map<string, { cents: number; count: number }>();
	for (const event of events) {
		if (!isIncomeEvent(event)) continue;
		if (event.event_date < from || event.event_date > to) continue;
		const day = byDate.get(event.event_date) ?? { cents: 0, count: 0 };
		day.cents += cents(event.total_value as number | string);
		day.count += 1;
		byDate.set(event.event_date, day);
	}
	return [...byDate].sort(([a], [b]) => a.localeCompare(b));
}

// Any run of consecutive payment dates inside the window may be one deposit.
function matchingRun(
	days: Array<[string, { cents: number; count: number }]>,
	target: number
) {
	for (let start = 0; start < days.length; start += 1) {
		let total = 0;
		let count = 0;
		for (let end = start; end < days.length; end += 1) {
			total += days[end][1].cents;
			count += days[end][1].count;
			if (Math.abs(total - target) <= TOLERANCE_CENTS) {
				return { eventDate: days[end][0], count };
			}
		}
	}
	return null;
}

function redemptionNearby(events: B3Event[], date: string): boolean {
	const from = shiftIsoDate(date, -REDEMPTION_WINDOW_DAYS);
	return events.some(
		(event) =>
			event.event_date >= from &&
			event.event_date <= date &&
			REDEMPTION_TYPE.test(foldForMatch(event.event_type))
	);
}

export function reconcileCredit(
	credit: { date: string; amount: number | string },
	events: B3Event[]
): CreditMatch {
	const target = cents(credit.amount);
	if (target <= 0) return null;
	const income = matchingRun(
		incomeByDate(
			events,
			shiftIsoDate(credit.date, -INCOME_WINDOW_DAYS),
			credit.date
		),
		target
	);
	if (income) return { kind: 'investment_income', ...income };
	if (
		target >= MIN_REDEMPTION_CREDIT * 100 &&
		redemptionNearby(events, credit.date)
	) {
		return { kind: 'redemption_likely' };
	}
	return null;
}

export interface CategoryOption {
	id: string;
	name: string;
	parent_id: string | null;
	financial_treatment?: string | null;
}

// The category a matched credit is filed under: one the household marked as
// investment income, preferring a subcategory (so the parent is kept too).
export function pickInvestmentIncomeCategory(
	categories: CategoryOption[]
): { category_id: string; subcategory_id: string | null } | null {
	const marked = categories.filter(
		(category) => category.financial_treatment === 'investment_income'
	);
	const chosen = marked.find((category) => category.parent_id) ?? marked[0];
	if (!chosen) return null;
	return chosen.parent_id
		? { category_id: chosen.parent_id, subcategory_id: chosen.id }
		: { category_id: chosen.id, subcategory_id: null };
}
