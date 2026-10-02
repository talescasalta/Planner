import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { selectAllStrict } from '$lib/server/supabase-paging';

export const NO_ACCOUNT_LABEL = 'Conta não informada';
export const MAX_ACCOUNT_NAME_CHARS = 60;

// What the import form posts: trimmed, single-spaced and bounded, so
// "Itaú  conta " and "Itaú conta" are the same account.
export function normalizeAccountName(value: unknown): string {
	return String(value ?? '')
		.trim()
		.replace(/\s+/g, ' ')
		.slice(0, MAX_ACCOUNT_NAME_CHARS);
}

export interface AccountOption {
	name: string;
	source_type: string | null;
}

export async function loadAccountNames(
	supabase: SupabaseClient<Database>,
	householdId: string
): Promise<AccountOption[]> {
	const rows = await selectAllStrict<{
		source_name: string | null;
		source_type: string | null;
	}>('contas', (from, to) =>
		supabase
			.from('transactions')
			.select('source_name, source_type')
			.eq('household_id', householdId)
			.not('source_name', 'is', null)
			.order('id', { ascending: true })
			.range(from, to)
	);
	const byName = new Map<string, AccountOption>();
	for (const row of rows) {
		if (row.source_name && !byName.has(row.source_name)) {
			byName.set(row.source_name, {
				name: row.source_name,
				source_type: row.source_type
			});
		}
	}
	return Array.from(byName.values()).sort((a, b) =>
		a.name.localeCompare(b.name, 'pt-BR')
	);
}

// ok: the month has rows. gap: no rows although the account has data before
// and the month already closed -- the likely missing statement. none: nothing
// to expect (before the account's first month, or the month still running).
export type CoverageState = 'ok' | 'gap' | 'none';

export interface CoverageCell {
	month: string;
	count: number;
	state: CoverageState;
}

export interface CoverageRow {
	account: string;
	cells: CoverageCell[];
}

export interface Coverage {
	months: string[];
	rows: CoverageRow[];
}

function shiftMonth(month: string, delta: number): string {
	const [year, monthNumber] = month.split('-').map(Number);
	const index = year * 12 + (monthNumber - 1) + delta;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function buildCoverage(
	rows: Array<{ source_name: string | null; reference_month: string | null }>,
	currentMonth: string,
	monthCount = 12
): Coverage {
	const months = Array.from({ length: monthCount }, (_, index) =>
		shiftMonth(currentMonth, index - (monthCount - 1))
	);
	const inWindow = new Set(months);
	const counts = new Map<string, Map<string, number>>();
	for (const row of rows) {
		if (!row.reference_month || !inWindow.has(row.reference_month)) continue;
		const account = row.source_name || NO_ACCOUNT_LABEL;
		const perMonth = counts.get(account) ?? new Map<string, number>();
		perMonth.set(
			row.reference_month,
			(perMonth.get(row.reference_month) ?? 0) + 1
		);
		counts.set(account, perMonth);
	}
	const accounts = Array.from(counts.keys()).sort((a, b) => {
		if (a === NO_ACCOUNT_LABEL) return 1;
		if (b === NO_ACCOUNT_LABEL) return -1;
		return a.localeCompare(b, 'pt-BR');
	});
	return {
		months,
		rows: accounts.map((account) => {
			const perMonth = counts.get(account) ?? new Map<string, number>();
			const firstMonth = months.find((month) => perMonth.has(month));
			return {
				account,
				cells: months.map((month): CoverageCell => {
					const count = perMonth.get(month) ?? 0;
					if (count > 0) return { month, count, state: 'ok' };
					const expected =
						firstMonth !== undefined &&
						month > firstMonth &&
						month < currentMonth;
					return { month, count: 0, state: expected ? 'gap' : 'none' };
				})
			};
		})
	};
}

export async function loadCoverage(
	supabase: SupabaseClient<Database>,
	householdId: string,
	currentMonth: string,
	monthCount = 12
): Promise<Coverage> {
	const since = shiftMonth(currentMonth, -(monthCount - 1));
	const rows = await selectAllStrict<{
		source_name: string | null;
		reference_month: string | null;
	}>('cobertura dos extratos', (from, to) =>
		supabase
			.from('transactions')
			.select('source_name, reference_month')
			.eq('household_id', householdId)
			.neq('review_status', 'ignored')
			.gte('reference_month', since)
			.order('id', { ascending: true })
			.range(from, to)
	);
	return buildCoverage(rows, currentMonth, monthCount);
}
