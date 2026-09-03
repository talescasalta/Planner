import { describe, expect, it, vi } from 'vitest';
import { SUPABASE_PAGE_SIZE, selectAll } from './supabase-paging';

// A fake table whose pages behave like PostgREST: inclusive ranges, capped at
// the page size no matter how much was asked for.
function fakeTable(total: number) {
	const all = Array.from({ length: total }, (_, index) => ({ id: index }));
	const calls: [number, number][] = [];
	const page = async (from: number, to: number) => {
		calls.push([from, to]);
		const size = Math.min(to - from + 1, SUPABASE_PAGE_SIZE);
		return { data: all.slice(from, from + size), error: null };
	};
	return { all, calls, page };
}

describe('selectAll', () => {
	it('reads a table larger than one page in full', async () => {
		const table = fakeTable(SUPABASE_PAGE_SIZE * 2 + 144);

		const rows = await selectAll('quotes', table.page);

		expect(rows).toHaveLength(SUPABASE_PAGE_SIZE * 2 + 144);
		expect(rows).toEqual(table.all);
		expect(table.calls).toHaveLength(3);
	});

	it('stops after one call when the first page is short', async () => {
		const table = fakeTable(10);

		const rows = await selectAll('events', table.page);

		expect(rows).toHaveLength(10);
		expect(table.calls).toEqual([[0, SUPABASE_PAGE_SIZE - 1]]);
	});

	// A table that is an exact multiple needs the extra empty page to know it
	// has ended; stopping early there is the same silent truncation again.
	it('asks one more page when the last one filled exactly', async () => {
		const table = fakeTable(SUPABASE_PAGE_SIZE);

		const rows = await selectAll('quotes', table.page);

		expect(rows).toHaveLength(SUPABASE_PAGE_SIZE);
		expect(table.calls).toHaveLength(2);
	});

	it('reports a failed page instead of returning a short read quietly', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const page = vi
			.fn()
			.mockResolvedValueOnce({
				data: Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => ({ id: i })),
				error: null
			})
			.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });

		const rows = await selectAll('quotes', page);

		expect(rows).toHaveLength(SUPABASE_PAGE_SIZE);
		expect(spy).toHaveBeenCalledOnce();
		spy.mockRestore();
	});

	it('handles an empty table', async () => {
		const table = fakeTable(0);

		expect(await selectAll('quotes', table.page)).toEqual([]);
	});
});
