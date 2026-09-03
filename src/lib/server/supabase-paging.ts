// PostgREST caps every response at a fixed number of rows — 1000 on Supabase
// by default — and it does so silently. A select over a table that has grown
// past the cap simply comes back short, with no error and no indication that
// anything is missing, and which rows survive depends on physical order rather
// than on anything meaningful.
//
// That is how the investment quotes went blind: 9.144 rows in the table, 1.000
// read, and the newest days were the ones that fell off. Every read here that
// can outgrow a single page walks the ranges instead of trusting one call.

export const SUPABASE_PAGE_SIZE = 1000;

interface PageResult<T> {
	data: T[] | null;
	error: { message: string } | null;
}

/**
 * Reads every row of a query by walking `.range()` until a short page arrives.
 *
 * The query MUST carry a stable `.order(...)` on something unique — the
 * primary key is always safe — because ranges over an unordered result can
 * repeat or skip rows between calls.
 */
export async function selectAll<T>(
	label: string,
	page: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
	const rows: T[] = [];
	for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
		const { data, error } = await page(from, from + SUPABASE_PAGE_SIZE - 1);
		if (error) {
			// Returning a short read silently is the very failure this module
			// exists to prevent, so say so where it can be seen.
			console.error(`[supabase] leitura paginada de ${label} falhou`, error);
			break;
		}
		const batch = data ?? [];
		rows.push(...batch);
		if (batch.length < SUPABASE_PAGE_SIZE) break;
	}
	return rows;
}
