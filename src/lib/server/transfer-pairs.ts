import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import {
	resolveFinancialTreatment,
	type FinancialCategory
} from '$lib/server/financial-treatment';
import { mentionsOwnName } from './own-names';
import { shiftIsoDate } from './import-duplicates';

// A Pix between two accounts of the household shows up on both statements,
// with the same amount and opposite sign. It is only called a transfer when one
// of the two descriptions carries a name the household registered as its own:
// without that, a reimbursement of the same amount paid to someone else would
// be paired by coincidence.

const MAX_PAIR_DAYS = 2;

export interface PairRow {
	id: string;
	date: string;
	amount: number | string;
	description: string;
	source_name: string | null;
	/** Already counted as a transfer (flag, row override or category). */
	isTransfer: boolean;
}

export interface TransferPair {
	insertedId: string;
	candidateId: string;
}

function cents(value: number | string): number {
	return Math.round(Number(value) * 100);
}

function dayDistance(a: string, b: string): number {
	return (
		Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
		86_400_000
	);
}

function couldBePair(
	inserted: PairRow,
	candidate: PairRow,
	ownNames: readonly string[]
): boolean {
	return (
		!inserted.isTransfer &&
		!candidate.isTransfer &&
		!!inserted.source_name &&
		!!candidate.source_name &&
		inserted.source_name !== candidate.source_name &&
		cents(inserted.amount) === -cents(candidate.amount) &&
		dayDistance(inserted.date, candidate.date) <= MAX_PAIR_DAYS &&
		(mentionsOwnName(inserted.description, ownNames) ||
			mentionsOwnName(candidate.description, ownNames))
	);
}

// Pairs only when the match is unambiguous in both directions: the new row has
// exactly one possible counterpart and that counterpart has exactly one
// possible new row. Anything murkier is left for the user.
export function matchTransferPairs(
	inserted: PairRow[],
	candidates: PairRow[],
	ownNames: readonly string[]
): TransferPair[] {
	if (ownNames.length === 0) return [];
	const options = inserted.map((row) =>
		candidates.filter((candidate) => couldBePair(row, candidate, ownNames))
	);
	const claims = new Map<string, number>();
	for (const list of options) {
		for (const candidate of list) {
			claims.set(candidate.id, (claims.get(candidate.id) ?? 0) + 1);
		}
	}
	return inserted.flatMap((row, index) => {
		const [only, ...rest] = options[index];
		return only && rest.length === 0 && claims.get(only.id) === 1
			? [{ insertedId: row.id, candidateId: only.id }]
			: [];
	});
}

type TransferRow = {
	id: string;
	date: string;
	amount: number | string;
	description: string;
	source_name: string | null;
	is_transfer: boolean | null;
	financial_treatment_override: string | null;
	category_id: string | null;
	subcategory_id: string | null;
};

const TRANSFER_COLUMNS =
	'id, date, amount, description, source_name, is_transfer, financial_treatment_override, category_id, subcategory_id';

function toPairRow(
	row: TransferRow,
	categories: ReadonlyMap<string, FinancialCategory>
): PairRow {
	const treatment = resolveFinancialTreatment(
		{
			amount: row.amount,
			is_transfer: row.is_transfer,
			financial_treatment_override: row.financial_treatment_override as never,
			category: categories.get(row.category_id ?? '') ?? null,
			subcategory: categories.get(row.subcategory_id ?? '') ?? null
		},
		categories
	);
	return {
		id: row.id,
		date: row.date,
		amount: row.amount,
		description: row.description,
		source_name: row.source_name,
		isTransfer: treatment === 'transfer'
	};
}

async function loadOwnNames(
	db: SupabaseClient<Database>,
	householdId: string
): Promise<string[]> {
	const { data } = await db
		.from('households')
		.select('own_account_names')
		.eq('id', householdId)
		.maybeSingle();
	return (data?.own_account_names ?? []) as string[];
}

async function loadPairContext(
	db: SupabaseClient<Database>,
	householdId: string,
	insertedIds: string[]
) {
	const { data: insertedRows, error } = await db
		.from('transactions')
		.select(TRANSFER_COLUMNS)
		.eq('household_id', householdId)
		.neq('review_status', 'ignored')
		.in('id', insertedIds);
	if (error) throw new Error(error.message);
	const dates = (insertedRows ?? []).map((row: TransferRow) => row.date).sort();
	if (dates.length === 0) return null;
	const [candidates, categories] = await Promise.all([
		db
			.from('transactions')
			.select(TRANSFER_COLUMNS)
			.eq('household_id', householdId)
			.neq('review_status', 'ignored')
			.not('source_name', 'is', null)
			.gte('date', shiftIsoDate(dates[0], -MAX_PAIR_DAYS))
			.lte('date', shiftIsoDate(dates[dates.length - 1], MAX_PAIR_DAYS)),
		db
			.from('categories')
			.select('id, name, parent_id, financial_treatment')
			.eq('household_id', householdId)
	]);
	if (candidates.error) throw new Error(candidates.error.message);
	const categoryMap = new Map<string, FinancialCategory>(
		(categories.data ?? []).map((category: FinancialCategory) => [
			category.id,
			category
		])
	);
	return {
		inserted: (insertedRows as TransferRow[]).map((row) =>
			toPairRow(row, categoryMap)
		),
		candidates: ((candidates.data ?? []) as TransferRow[]).map((row) =>
			toPairRow(row, categoryMap)
		)
	};
}

async function markPair(
	db: SupabaseClient<Database>,
	householdId: string,
	row: PairRow,
	other: PairRow
) {
	const { error } = await db
		.from('transactions')
		.update({
			financial_treatment_override: 'transfer',
			review_status: 'needs_review',
			classification_suggestion: {
				type: 'transfer_pair',
				reason_code: 'transfer_pair',
				pair_id: other.id,
				pair_description: other.description,
				pair_account: other.source_name
			}
		})
		.eq('id', row.id)
		.eq('household_id', householdId);
	if (error) throw new Error(error.message);
}

// Called after an import is written. A suggestion is a convenience: any
// failure here is logged and never fails the import that already succeeded.
export async function suggestTransferPairs(
	db: SupabaseClient<Database>,
	householdId: string,
	insertedIds: string[]
): Promise<number> {
	try {
		if (insertedIds.length === 0) return 0;
		const ownNames = await loadOwnNames(db, householdId);
		if (ownNames.length === 0) return 0;
		const context = await loadPairContext(db, householdId, insertedIds);
		if (!context) return 0;
		const pairs = matchTransferPairs(
			context.inserted,
			context.candidates,
			ownNames
		);
		const byId = new Map(
			[...context.inserted, ...context.candidates].map((row) => [row.id, row])
		);
		for (const pair of pairs) {
			const inserted = byId.get(pair.insertedId);
			const candidate = byId.get(pair.candidateId);
			if (!inserted || !candidate) continue;
			await markPair(db, householdId, inserted, candidate);
			await markPair(db, householdId, candidate, inserted);
		}
		return pairs.length;
	} catch (error) {
		console.error('[imports] transfer pair suggestion failed', String(error));
		return 0;
	}
}
