import { describe, expect, it, vi } from 'vitest';
import { suggestTransferPairs } from './transfer-pairs';

type Result = { data: unknown; error: { message: string } | null };

const ok = (data: unknown): Result => ({ data, error: null });

// Answers every chained call with a fixed result and remembers what was
// written, whatever filters were chained on.
class Query {
	constructor(
		private readonly result: Result,
		private readonly onUpdate?: (payload: unknown, filters: unknown[]) => void
	) {}
	private filters: unknown[] = [];
	select() {
		return this;
	}
	update(payload: unknown) {
		this.onUpdate?.(payload, this.filters);
		return this;
	}
	eq(column: string, value: unknown) {
		this.filters.push([column, value]);
		return this;
	}
	neq() {
		return this;
	}
	in() {
		return this;
	}
	not() {
		return this;
	}
	gte() {
		return this;
	}
	lte() {
		return this;
	}
	maybeSingle() {
		return Promise.resolve(this.result);
	}
	then(resolve: (value: Result) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
}

const base = {
	is_transfer: false,
	financial_treatment_override: null,
	category_id: null,
	subcategory_id: null
};
const itauRow = {
	...base,
	id: 'itau',
	date: '2026-09-03',
	amount: 1000,
	description: 'PIX TRANSF Maria S03/09',
	source_name: 'Itaú conta'
};
const nubankRow = {
	...base,
	id: 'nu',
	date: '2026-09-03',
	amount: -1000,
	description: 'Transferência enviada pelo Pix - Maria Silva',
	source_name: 'Nubank conta'
};

function fakeDb(ownNames: string[]) {
	const updates: Array<{ payload: unknown; filters: unknown[] }> = [];
	// transactions is read twice (the new rows, then the candidates); every
	// later call is a write.
	const reads = [ok([itauRow]), ok([itauRow, nubankRow])];
	const db = {
		from: (table: string) => {
			if (table === 'households') {
				return new Query(ok({ own_account_names: ownNames }));
			}
			if (table === 'categories') return new Query(ok([]));
			return new Query(reads.shift() ?? ok(null), (payload, filters) =>
				updates.push({ payload, filters })
			);
		}
	};
	return { db: db as never, updates };
}

describe('suggestTransferPairs', () => {
	it('marks both sides of a pair as a transfer awaiting review', async () => {
		const { db, updates } = fakeDb(['Maria Silva', 'Maria S']);

		const count = await suggestTransferPairs(db, 'household-a', ['itau']);

		expect(count).toBe(1);
		expect(updates).toHaveLength(2);
		expect(updates.map((u) => u.filters)).toEqual([
			[
				['id', 'itau'],
				['household_id', 'household-a']
			],
			[
				['id', 'nu'],
				['household_id', 'household-a']
			]
		]);
		for (const { payload } of updates) {
			expect(payload).toMatchObject({
				financial_treatment_override: 'transfer',
				review_status: 'needs_review',
				classification_suggestion: { reason_code: 'transfer_pair' }
			});
		}
		expect(updates[0].payload).toMatchObject({
			classification_suggestion: {
				pair_id: 'nu',
				pair_account: 'Nubank conta'
			}
		});
	});

	it('writes nothing until the household has registered its names', async () => {
		const { db, updates } = fakeDb([]);

		await expect(
			suggestTransferPairs(db, 'household-a', ['itau'])
		).resolves.toBe(0);
		expect(updates).toEqual([]);
	});

	it('never fails the import when the lookup breaks', async () => {
		const errorSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		const db = {
			from: () => {
				throw new Error('database unavailable');
			}
		} as never;

		await expect(
			suggestTransferPairs(db, 'household-a', ['itau'])
		).resolves.toBe(0);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it('skips the lookup when nothing was inserted', async () => {
		const { db, updates } = fakeDb(['Maria S']);

		await expect(suggestTransferPairs(db, 'household-a', [])).resolves.toBe(0);
		expect(updates).toEqual([]);
	});
});
