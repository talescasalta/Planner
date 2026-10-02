import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { selectAllStrict } from '$lib/server/supabase-paging';
import { shiftIsoDate } from '$lib/server/import-duplicates';
import {
	isGenericBankCredit,
	pickInvestmentIncomeCategory,
	reconcileCredit,
	type B3Event,
	type CategoryOption,
	type CreditMatch
} from '$lib/server/b3-reconciliation';

type TxUpdate = Database['public']['Tables']['transactions']['Update'];

export interface CreditRow {
	id: string;
	description: string;
	clean_description?: string | null;
	amount: number | string;
	date: string;
	source_type?: string | null;
}

export interface B3Classification {
	method: 'rule';
	needs_review: boolean;
	patch: TxUpdate;
	/**
	 * Not part of the batch classification RPC, so it is written separately
	 * once that succeeds.
	 */
	treatmentOverride?: 'investment';
}

// Back to the first payment date a deposit could be bundling.
const LOOKBACK_DAYS = 10;

function candidateCredits(rows: CreditRow[]): CreditRow[] {
	return rows.filter(
		(row) =>
			Number(row.amount) > 0 &&
			row.source_type === 'bank_account' &&
			isGenericBankCredit(row.clean_description || row.description)
	);
}

async function loadB3Events(
	supabase: SupabaseClient<Database>,
	householdId: string,
	credits: CreditRow[]
): Promise<B3Event[]> {
	const dates = credits.map((credit) => credit.date).sort();
	const from = shiftIsoDate(dates[0], -LOOKBACK_DAYS);
	const to = dates[dates.length - 1];
	return selectAllStrict<B3Event>('eventos da B3', (start, end) =>
		supabase
			.from('investment_events')
			.select('event_date, event_type, direction, total_value, source')
			.eq('household_id', householdId)
			.eq('source', 'b3_movimentacao')
			.gte('event_date', from)
			.lte('event_date', to)
			.order('id', { ascending: true })
			.range(start, end)
	);
}

function classificationFor(
	match: CreditMatch,
	incomeCategory: ReturnType<typeof pickInvestmentIncomeCategory>
): B3Classification | null {
	if (match?.kind === 'investment_income' && incomeCategory) {
		return {
			method: 'rule',
			needs_review: false,
			patch: {
				...incomeCategory,
				classification_method: 'rule',
				classification_confidence: 0.95,
				review_status: 'confirmed',
				classification_suggestion: {
					type: 'b3_match',
					reason_code: 'b3_income_match',
					event_date: match.eventDate,
					events: match.count
				}
			} as TxUpdate
		};
	}
	if (match?.kind === 'redemption_likely') {
		return {
			method: 'rule',
			needs_review: true,
			patch: {
				category_id: null,
				subcategory_id: null,
				classification_method: 'rule',
				classification_confidence: 0.6,
				review_status: 'needs_review',
				classification_suggestion: {
					type: 'b3_match',
					reason_code: 'b3_redemption_nearby'
				}
			} as TxUpdate,
			treatmentOverride: 'investment'
		};
	}
	return null;
}

// Recognizes "Crédito em conta" deposits that are B3 payments or the proceeds
// of a redemption. A lookup failure only means these deposits fall back to the
// usual classification; it never blocks it.
export async function reconcileB3Credits(
	supabase: SupabaseClient<Database>,
	householdId: string,
	rows: CreditRow[],
	categories: CategoryOption[]
): Promise<Map<string, B3Classification>> {
	const matches = new Map<string, B3Classification>();
	const credits = candidateCredits(rows);
	if (credits.length === 0) return matches;
	try {
		const events = await loadB3Events(supabase, householdId, credits);
		const incomeCategory = pickInvestmentIncomeCategory(categories);
		for (const credit of credits) {
			const classification = classificationFor(
				reconcileCredit(credit, events),
				incomeCategory
			);
			if (classification) matches.set(credit.id, classification);
		}
	} catch (error) {
		console.error('[classifier] B3 reconciliation failed', String(error));
	}
	return matches;
}
