import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({
	supabaseAdmin: { from: () => ({ upsert: mocks.upsert }) }
}));
import { fetchCdiRates } from './investment-cdi';
import { writeQuoteBatches } from './investment-quote-write';

beforeEach(() => vi.clearAllMocks());

it('accepts the SGS empty window but surfaces unrelated failures', async () => {
	const fetcher = vi.fn<typeof fetch>();
	fetcher.mockResolvedValueOnce(
		new Response(
			JSON.stringify({
				erro: {
					detail:
						'br.gov.bcb.pec.sgs.comum.excecoes.SGSNegocioException: Value(s) not found'
				}
			}),
			{ status: 404 }
		)
	);
	await expect(
		fetchCdiRates('2026-09-11', '2026-09-12', fetcher)
	).resolves.toEqual([]);
	for (const status of [404, 500]) {
		fetcher.mockResolvedValueOnce(new Response('unavailable', { status }));
		await expect(
			fetchCdiRates('2026-09-11', '2026-09-12', fetcher)
		).rejects.toThrow(`BCB SGS respondeu ${status}`);
	}
});

const rows = Array.from({ length: 401 }, (_, i) => ({
	household_id: 'household',
	asset_id: `asset-${i}`,
	quote_date: '2026-09-10',
	price: 1,
	source: 'yahoo'
}));

it('writes bounded batches without requesting rows and counts only affected records', async () => {
	mocks.upsert
		.mockResolvedValueOnce({ count: 190 })
		.mockResolvedValueOnce({ count: 0 })
		.mockResolvedValueOnce({ count: 1 });
	await expect(writeQuoteBatches(rows, true)).resolves.toEqual({
		written: 191
	});
	expect(mocks.upsert.mock.calls.map(([batch]) => batch.length)).toEqual([
		200, 200, 1
	]);
	expect(mocks.upsert.mock.calls[0][1]).toEqual({
		onConflict: 'asset_id,quote_date',
		ignoreDuplicates: true,
		count: 'exact'
	});
});

it('stops on a failed batch and reports only confirmed writes', async () => {
	mocks.upsert
		.mockResolvedValueOnce({ count: 200 })
		.mockResolvedValueOnce({
			status: 504,
			error: { message: 'Gateway Timeout' }
		});
	await expect(writeQuoteBatches(rows, false)).resolves.toEqual({
		written: 200,
		error: 'batch 2 (200 rows, HTTP 504): Gateway Timeout'
	});
	expect(mocks.upsert).toHaveBeenCalledTimes(2);
});
