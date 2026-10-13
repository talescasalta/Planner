import { describe, expect, it, vi } from 'vitest';
import {
	PARALLEL_PAGES,
	SUPABASE_PAGE_SIZE,
	selectAll,
	selectAllStrict
} from './supabase-paging';

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
		// First page alone, then one parallel batch that reaches the end.
		expect(table.calls).toHaveLength(1 + PARALLEL_PAGES);
	});

	it('requests the pages after a full first one in parallel', async () => {
		const total = SUPABASE_PAGE_SIZE * 6 + 7;
		const all = Array.from({ length: total }, (_, index) => ({ id: index }));
		let inFlight = 0;
		let peak = 0;
		const page = async (from: number, to: number) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 1));
			inFlight -= 1;
			return { data: all.slice(from, to + 1), error: null };
		};

		const rows = await selectAllStrict('quotes', page);

		expect(rows).toEqual(all);
		expect(peak).toBe(PARALLEL_PAGES);
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
		expect(table.calls[1]).toEqual([
			SUPABASE_PAGE_SIZE,
			SUPABASE_PAGE_SIZE * 2 - 1
		]);
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

	it('throws on a failed page so financial totals cannot be partial', async () => {
		const page = vi
			.fn()
			.mockResolvedValueOnce({
				data: Array.from({ length: SUPABASE_PAGE_SIZE }, (_, i) => ({ id: i })),
				error: null
			})
			.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(selectAllStrict('transactions', page)).rejects.toThrow(
			'Não foi possível carregar transactions: timeout'
		);

		expect(spy).toHaveBeenCalledOnce();
		spy.mockRestore();
	});
});
