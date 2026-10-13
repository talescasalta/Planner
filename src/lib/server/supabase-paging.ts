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

// After a full first page, the next ones are requested this many at a time
// instead of one after another: 25k investment quotes used to be 26 round
// trips in a row. A short page ends the read; the few speculative pages past
// it come back empty and are ignored.
export const PARALLEL_PAGES = 4;

interface PageResult<T> {
	data: T[] | null;
	error: { message: string } | null;
}

type PageFetch<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

// Walks the ranges in order. Rows from pages before a failed one are kept and
// everything after it is dropped, exactly as the one-by-one walk did; what
// happens next is up to `onError`.
async function readPages<T>(
	page: PageFetch<T>,
	onError: (error: { message: string }) => void
): Promise<T[]> {
	const rows: T[] = [];
	let from = 0;
	let batchSize = 1;
	for (;;) {
		const offsets = Array.from(
			{ length: batchSize },
			(_, index) => from + index * SUPABASE_PAGE_SIZE
		);
		const results = await Promise.all(
			offsets.map((offset) => page(offset, offset + SUPABASE_PAGE_SIZE - 1))
		);
		for (const { data, error } of results) {
			if (error) {
				onError(error);
				return rows;
			}
			const batch = data ?? [];
			rows.push(...batch);
			if (batch.length < SUPABASE_PAGE_SIZE) return rows;
		}
		from += batchSize * SUPABASE_PAGE_SIZE;
		batchSize = PARALLEL_PAGES;
	}
}

/**
 * Reads every row of a query by walking `.range()` until a short page arrives.
 *
 * The query MUST carry a stable `.order(...)` on something unique — the
 * primary key is always safe — because ranges over an unordered result can
 * repeat or skip rows between calls.
 */
export function selectAll<T>(label: string, page: PageFetch<T>): Promise<T[]> {
	return readPages(page, (error) => {
		// Returning a short read silently is the very failure this module
		// exists to prevent, so say so where it can be seen.
		console.error(`[supabase] leitura paginada de ${label} falhou`, error);
	});
}

/**
 * Strict counterpart for financial totals. A failed middle page must never be
 * rendered as a complete history or total, so callers receive an error and
 * can show a load failure instead of partial data.
 */
export function selectAllStrict<T>(
	label: string,
	page: PageFetch<T>
): Promise<T[]> {
	return readPages(page, (error) => {
		console.error('[supabase] leitura paginada de ' + label + ' falhou', error);
		throw new Error(
			'Não foi possível carregar ' + label + ': ' + error.message
		);
	});
}
