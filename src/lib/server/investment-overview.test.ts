import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import {
	lastQuoteDate,
	lastSnapshotDate,
	loadInvestmentRows,
	valuePositions,
	type InvestmentRows
} from './investment-overview';
import type { QuoteRow, SnapshotRow } from './investment-positions';

// A Supabase stub that counts how many times each table was queried, so the
// request-scoped sharing can be asserted rather than assumed.
function stubClient() {
	const calls: string[] = [];
	const client = {
		from(table: string) {
			calls.push(table);
			const builder = {
				select: () => builder,
				eq: () => builder,
				in: () => builder,
				then: (resolve: (value: { data: unknown[] }) => unknown) =>
					Promise.resolve({ data: [] }).then(resolve)
			};
			return builder;
		}
	} as unknown as SupabaseClient<Database>;
	return { client, calls };
}

describe('loadInvestmentRows', () => {
	it('reads the four tables once and shares the result within a request', async () => {
		const { client, calls } = stubClient();

		const [first, second] = await Promise.all([
			loadInvestmentRows(client, 'household-1'),
			loadInvestmentRows(client, 'household-1')
		]);

		expect(calls).toHaveLength(4);
		expect(first).toBe(second);
	});

	it('does not share across households or with a by-id read', async () => {
		const { client, calls } = stubClient();

		await loadInvestmentRows(client, 'household-1');
		await loadInvestmentRows(client, 'household-2');
		await loadInvestmentRows(client, 'household-1', ['asset-1']);

		expect(calls).toHaveLength(12);
	});

	it('keeps separate requests separate', async () => {
		const first = stubClient();
		const second = stubClient();

		await loadInvestmentRows(first.client, 'household-1');
		await loadInvestmentRows(second.client, 'household-1');

		expect(first.calls).toHaveLength(4);
		expect(second.calls).toHaveLength(4);
	});
});

const snapshot = (
	assetId: string,
	date: string,
	quantity: number,
	price: number | null,
	netValue?: number
): SnapshotRow =>
	({
		asset_id: assetId,
		snapshot_date: date,
		quantity,
		close_price: price,
		net_value: netValue ?? (price === null ? 0 : quantity * price)
	}) as SnapshotRow;

const quote = (
	assetId: string,
	date: string,
	price: number,
	source: string
): QuoteRow =>
	({ asset_id: assetId, quote_date: date, price, source }) as QuoteRow;

describe('valuePositions', () => {
	it('values a holding at its freshest price', () => {
		const rows = {
			assets: [{ id: 'a1' }],
			snapshots: [snapshot('a1', '2026-08-01', 10, 20)],
			events: [],
			quotes: [quote('a1', '2026-08-20', 25, 'yahoo')]
		} as unknown as InvestmentRows;

		const [position] = valuePositions(rows);

		expect(position.quantity).toBe(10);
		expect(position.price).toBe(25);
		expect(position.value).toBe(250);
	});

	// Fixed income has no published quote, so the snapshot's own net value is
	// what keeps it in the patrimony instead of vanishing at zero.
	it('falls back to the price implied by the snapshot', () => {
		const rows = {
			assets: [{ id: 'a1' }],
			snapshots: [snapshot('a1', '2026-08-01', 10, null, 500)],
			events: [],
			quotes: []
		} as unknown as InvestmentRows;

		const [position] = valuePositions(rows);

		expect(position.price).toBe(50);
		expect(position.value).toBe(500);
	});

	it('reports no price when nothing values the asset at all', () => {
		const rows = {
			assets: [{ id: 'a1' }],
			snapshots: [],
			events: [],
			quotes: []
		} as unknown as InvestmentRows;

		const [position] = valuePositions(rows);

		expect(position.price).toBeNull();
		expect(position.value).toBe(0);
	});
});

describe('freshness dates', () => {
	it('ignores snapshot-sourced quotes when reporting the last priced day', () => {
		const quotes = [
			quote('a1', '2026-08-31', 10, 'snapshot'),
			quote('a1', '2026-08-28', 11, 'yahoo')
		];

		expect(lastQuoteDate(quotes)).toBe('2026-08-28');
		expect(
			lastQuoteDate([quote('a1', '2026-08-31', 10, 'snapshot')])
		).toBeNull();
	});

	it('reports the newest reconciliation date', () => {
		const snapshots = [
			snapshot('a1', '2026-07-31', 1, 1),
			snapshot('a2', '2026-08-31', 1, 1)
		];

		expect(lastSnapshotDate(snapshots)).toBe('2026-08-31');
		expect(lastSnapshotDate([])).toBeNull();
	});
});
