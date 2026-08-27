import { describe, expect, it } from 'vitest';
import {
	classifyEvent,
	deriveQuantity,
	evolutionSeries,
	latestPrice,
	reconcile,
	type EventRow,
	type SnapshotRow
} from './investment-positions';

function event(partial: Partial<EventRow>): EventRow {
	return {
		asset_id: 'a1',
		event_date: '2026-08-10',
		event_type: 'Rendimento',
		direction: 'credit',
		quantity: null,
		unit_price: null,
		total_value: null,
		source: 'b3_movimentacao',
		...partial
	};
}

function snapshot(partial: Partial<SnapshotRow>): SnapshotRow {
	return {
		asset_id: 'a1',
		snapshot_date: '2026-08-01',
		quantity: 100,
		close_price: 10,
		net_value: 1000,
		...partial
	};
}

describe('classifyEvent', () => {
	it('maps the observed movimentação vocabulary', () => {
		expect(
			classifyEvent({
				event_type: 'Transferência - Liquidação',
				total_value: 100
			})
		).toBe('quantity');
		expect(
			classifyEvent({ event_type: 'RESGATE ANTECIPADO', total_value: 100 })
		).toBe('quantity');
		expect(classifyEvent({ event_type: 'Rendimento', total_value: 10 })).toBe(
			'income'
		);
		expect(classifyEvent({ event_type: 'Juros', total_value: 10 })).toBe(
			'income'
		);
		expect(
			classifyEvent({
				event_type: 'Cobrança de Taxa Semestral',
				total_value: 5
			})
		).toBe('fee');
		expect(classifyEvent({ event_type: 'Amortização', total_value: 50 })).toBe(
			'cost_basis'
		);
		expect(
			classifyEvent({ event_type: 'Cessão de Direitos', total_value: 0 })
		).toBe('none');
	});

	it('treats subscription rights as quantity only when exercised', () => {
		expect(
			classifyEvent({ event_type: 'Direito de Subscrição', total_value: 500 })
		).toBe('quantity');
		expect(
			classifyEvent({ event_type: 'Direito de Subscrição', total_value: 0 })
		).toBe('none');
		expect(
			classifyEvent({
				event_type: 'Direitos de Subscrição - Não Exercido',
				total_value: null
			})
		).toBe('none');
	});

	it('flags unseen types as unknown instead of dropping them', () => {
		expect(
			classifyEvent({
				event_type: 'Evento Corporativo Exótico',
				total_value: 1
			})
		).toBe('unknown');
	});

	it('is accent/case-insensitive (files mix Transferência and Transferencia)', () => {
		expect(
			classifyEvent({ event_type: 'Transferencia', total_value: null })
		).toBe('quantity');
		expect(
			classifyEvent({ event_type: 'TRANSFERÊNCIA', total_value: null })
		).toBe('quantity');
	});
});

describe('deriveQuantity', () => {
	it('starts from the latest snapshot and applies later events with sign', () => {
		const snapshots = [
			snapshot({ snapshot_date: '2026-07-01', quantity: 80 }),
			snapshot({ quantity: 100 })
		];
		const events = [
			event({
				event_date: '2026-08-05',
				event_type: 'Transferência - Liquidação',
				quantity: 10
			}),
			event({
				event_date: '2026-08-06',
				event_type: 'Venda',
				direction: 'debit',
				quantity: 30
			}),
			// Before the baseline: already inside the snapshot, must be ignored.
			event({ event_date: '2026-07-15', event_type: 'Compra', quantity: 999 })
		];
		const derived = deriveQuantity('a1', snapshots, events);
		expect(derived.quantity).toBe(80);
		expect(derived.baselineDate).toBe('2026-08-01');
	});

	it('ignores negociação rows to avoid double-counting settled trades', () => {
		const events = [
			event({
				event_date: '2026-08-05',
				event_type: 'Transferência - Liquidação',
				quantity: 10
			}),
			event({
				event_date: '2026-08-05',
				event_type: 'Compra',
				quantity: 10,
				source: 'b3_negociacao'
			})
		];
		expect(deriveQuantity('a1', [snapshot({})], events).quantity).toBe(110);
	});

	it('collects unknown event types without applying them', () => {
		const events = [
			event({ event_date: '2026-08-05', event_type: 'Coisa Nova', quantity: 5 })
		];
		const derived = deriveQuantity('a1', [snapshot({})], events);
		expect(derived.quantity).toBe(100);
		expect(derived.unknownEventTypes).toEqual(['Coisa Nova']);
	});

	it('income and amortization never move quantity', () => {
		const events = [
			event({
				event_date: '2026-08-05',
				event_type: 'Rendimento',
				quantity: 96
			}),
			event({
				event_date: '2026-08-06',
				event_type: 'Amortização',
				direction: 'credit',
				quantity: 96
			})
		];
		expect(deriveQuantity('a1', [snapshot({})], events).quantity).toBe(100);
	});

	it('works without any snapshot (movimentação-only history)', () => {
		const events = [
			event({ event_date: '2026-08-05', event_type: 'Compra', quantity: 40 })
		];
		const derived = deriveQuantity('a1', [], events);
		expect(derived.quantity).toBe(40);
		expect(derived.baselineDate).toBeNull();
	});
});

describe('latestPrice', () => {
	it('prefers the freshest quote', () => {
		const quotes = [
			{ asset_id: 'a1', quote_date: '2026-08-20', price: 12 },
			{ asset_id: 'a1', quote_date: '2026-08-25', price: 13 },
			{ asset_id: 'zz', quote_date: '2026-08-26', price: 99 }
		];
		expect(latestPrice('a1', quotes, [snapshot({})])).toEqual({
			price: 13,
			date: '2026-08-25'
		});
	});

	it('falls back to snapshot implied price (renda fixa without quotes)', () => {
		const rf = snapshot({
			close_price: null,
			quantity: 15000000,
			net_value: 154686
		});
		expect(latestPrice('a1', [], [rf])?.price).toBeCloseTo(154686 / 15000000);
	});
});

describe('reconcile', () => {
	it('reports divergences beyond tolerance and skips first-ever snapshots', () => {
		const prior = [snapshot({ snapshot_date: '2026-07-01', quantity: 100 })];
		const events = [
			event({
				event_date: '2026-07-10',
				event_type: 'Venda',
				direction: 'debit',
				quantity: 20
			})
		];
		const diffs = reconcile(
			[
				{ asset_id: 'a1', quantity: 75 }, // derived is 80 → diverges
				{ asset_id: 'novo', quantity: 50 } // no baseline → skipped
			],
			'2026-08-01',
			prior,
			events
		);
		expect(diffs).toHaveLength(1);
		expect(diffs[0]).toMatchObject({
			assetId: 'a1',
			derivedQuantity: 80,
			officialQuantity: 75,
			delta: -5
		});
	});

	it('is silent when everything matches', () => {
		const prior = [snapshot({ snapshot_date: '2026-07-01', quantity: 100 })];
		expect(
			reconcile([{ asset_id: 'a1', quantity: 100 }], '2026-08-01', prior, [])
		).toEqual([]);
	});
});

describe('evolutionSeries', () => {
	it('emits one point per snapshot date plus a computed today point', () => {
		const snapshots = [
			snapshot({ snapshot_date: '2026-07-01', net_value: 1000 }),
			snapshot({
				asset_id: 'a2',
				snapshot_date: '2026-07-01',
				quantity: 10,
				net_value: 500,
				close_price: null
			}),
			snapshot({ snapshot_date: '2026-08-01', net_value: 1100 })
		];
		const quotes = [{ asset_id: 'a1', quote_date: '2026-08-20', price: 12 }];
		const points = evolutionSeries(snapshots, [], quotes, '2026-08-27');
		expect(points.map((p) => p.date)).toEqual([
			'2026-07-01',
			'2026-08-01',
			'2026-08-27'
		]);
		expect(points[0].totalValue).toBe(1500);
		expect(points.at(-1)?.source).toBe('computed');
		// a1: 100 × 12 quote; a2: 10 × 50 implied from its snapshot.
		expect(points.at(-1)?.totalValue).toBe(100 * 12 + 10 * 50);
	});
});
