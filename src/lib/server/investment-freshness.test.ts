import { describe, expect, it } from 'vitest';
import { importFreshness, STALE_AFTER_DAYS } from './investment-freshness';

const now = new Date('2026-10-12T12:00:00Z');

describe('importFreshness', () => {
	it('is not stale when nothing was ever imported', () => {
		const result = importFreshness([], now);
		expect(result.stale).toBe(false);
		expect(result.lastMovimentacaoAt).toBeNull();
	});

	it('counts days since the latest movimentação', () => {
		const result = importFreshness(
			[
				{ sourceType: 'b3_movimentacao', createdAt: '2026-09-02T12:00:00Z' },
				{ sourceType: 'b3_movimentacao', createdAt: '2026-10-02T12:00:00Z' }
			],
			now
		);
		expect(result.daysSinceMovimentacao).toBe(10);
		expect(result.stale).toBe(false);
	});

	it('goes stale past the threshold', () => {
		const old = new Date(
			now.getTime() - (STALE_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000
		).toISOString();
		const result = importFreshness(
			[{ sourceType: 'b3_movimentacao', createdAt: old }],
			now
		);
		expect(result.stale).toBe(true);
	});

	it('flags posição-only users as stale: movimentação was never imported', () => {
		const result = importFreshness(
			[{ sourceType: 'b3_posicao', createdAt: '2026-10-10T12:00:00Z' }],
			now
		);
		expect(result.stale).toBe(true);
		expect(result.lastImportAt).toBe('2026-10-10T12:00:00Z');
	});

	it('ignores non-B3 imports', () => {
		const result = importFreshness(
			[{ sourceType: 'credit_card', createdAt: '2026-10-10T12:00:00Z' }],
			now
		);
		expect(result.lastImportAt).toBeNull();
		expect(result.stale).toBe(false);
	});
});
