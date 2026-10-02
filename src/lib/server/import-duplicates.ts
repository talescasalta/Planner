import { foldForMatch } from './own-names';

// The same bank movement often reaches the app twice through different
// sources: a screenshot of the app and the statement PDF describe one Pix
// differently ("Cleusa Braga" vs "PIX TRANSF CLEUSA 13/06"), so the content
// key of the import never matches. These rows are told apart from a repeat of
// a real purchase by what they share: the amount, the account and (within a
// day) the date -- while the description reads differently.

export interface ExistingTransaction {
	id: string;
	date: string;
	amount: number | string;
	description: string;
	clean_description: string | null;
	source_name: string | null;
	source_type: string | null;
	import_dedup_key: string | null;
	review_status: string;
}

export interface ImportCandidateRow {
	dedup_key: string;
	date: string;
	amount: number;
	description: string;
	clean_description: string;
}

export interface DuplicateTarget {
	accountName: string;
	sourceType: string;
}

export interface PossibleDuplicateView {
	date: string;
	description: string;
	amount: number;
	existing_date: string;
	existing_description: string;
}

const DAY_MS = 86_400_000;

function dayDistance(a: string, b: string): number {
	return (
		Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) /
		DAY_MS
	);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Rows whose date could not be read reach the importer as free text.
export function isIsoDate(value: string): boolean {
	return (
		ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
	);
}

export function shiftIsoDate(date: string, days: number): string {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
		.toISOString()
		.slice(0, 10);
}

function cents(value: number | string): number {
	return Math.round(Number(value) * 100);
}

// Same account by name when both sides have one; otherwise by kind of source.
function sameAccount(
	existing: ExistingTransaction,
	target: DuplicateTarget
): boolean {
	if (existing.source_name && target.accountName) {
		return (
			foldForMatch(existing.source_name) === foldForMatch(target.accountName)
		);
	}
	return existing.source_type === target.sourceType;
}

function isCandidate(
	row: ImportCandidateRow,
	existing: ExistingTransaction,
	target: DuplicateTarget
): boolean {
	return (
		existing.review_status !== 'ignored' &&
		cents(existing.amount) === cents(row.amount) &&
		dayDistance(existing.date, row.date) <= 1 &&
		sameAccount(existing, target) &&
		// Identical text a day apart is a repeated purchase, not another source.
		foldForMatch(existing.clean_description || existing.description) !==
			foldForMatch(row.clean_description || row.description)
	);
}

// Maps the dedup key of each possibly-duplicated row to the transaction it
// seems to repeat. Every existing transaction answers for at most one row, so
// two real purchases of the same amount are not both flagged by one match.
export function findPossibleDuplicates(
	rows: ImportCandidateRow[],
	existing: ExistingTransaction[],
	target: DuplicateTarget
): Map<string, ExistingTransaction> {
	const used = new Set<string>();
	const found = new Map<string, ExistingTransaction>();
	for (const row of rows) {
		const match = existing
			.filter((tx) => !used.has(tx.id) && isCandidate(row, tx, target))
			.sort(
				(a, b) => dayDistance(a.date, row.date) - dayDistance(b.date, row.date)
			)[0];
		if (!match) continue;
		used.add(match.id);
		found.set(row.dedup_key, match);
	}
	return found;
}

export interface ImportPlan<T extends ImportCandidateRow> {
	/** Keys already stored: rows with these are exact repeats and are skipped. */
	keys: Set<string>;
	exactDuplicates: number;
	/** Rows to write, each tagged with the transaction it may repeat. */
	toInsert: Array<T & { duplicate_of?: ExistingTransaction }>;
	possible: PossibleDuplicateView[];
}

export function planImport<T extends ImportCandidateRow>(
	rows: T[],
	existing: ExistingTransaction[],
	target: DuplicateTarget
): ImportPlan<T> {
	const keys = new Set(
		existing
			.map((tx) => tx.import_dedup_key)
			.filter((key): key is string => !!key)
	);
	const fresh = rows.filter((row) => !keys.has(row.dedup_key));
	const matches = findPossibleDuplicates(fresh, existing, target);
	return {
		keys,
		exactDuplicates: rows.length - fresh.length,
		toInsert: fresh.map((row) => ({
			...row,
			duplicate_of: matches.get(row.dedup_key)
		})),
		possible: fresh.flatMap((row) => {
			const match = matches.get(row.dedup_key);
			return match
				? [
						{
							date: row.date,
							description: row.description,
							amount: row.amount,
							existing_date: match.date,
							existing_description: match.description
						}
					]
				: [];
		})
	};
}
