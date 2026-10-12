import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/llm', () => ({ callLlm: vi.fn() }));
vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import { parseRendeExtraction } from './wise-print-extract';

describe('parseRendeExtraction', () => {
	it('keeps the native balance, gain and rate of each currency', () => {
		const result = parseRendeExtraction(
			JSON.stringify({
				balances: [
					{ currency: 'usd', balance: 1234.56, gain: 7.89, rate_percent: 3.5 }
				],
				rate_date: '2026-09-23',
				confidence: 0.95
			})
		);
		expect(result).toEqual({
			balances: [
				{ currency: 'USD', balance: 1234.56, gain: 7.89, ratePercent: 3.5 }
			],
			rateDate: '2026-09-23',
			confidence: 0.95,
			notes: undefined
		});
	});

	it('drops the BRL total and anything unusable', () => {
		const result = parseRendeExtraction(
			JSON.stringify({
				balances: [
					{ currency: 'BRL', balance: 6000 },
					{ currency: 'USD', balance: 0 },
					{ currency: 'EUR', balance: 50, rate_percent: 250 }
				],
				rate_date: '23/09/2026',
				confidence: 0.8
			})
		);
		expect(result.balances).toEqual([
			{ currency: 'EUR', balance: 50, gain: null, ratePercent: null }
		]);
		expect(result.rateDate).toBeNull();
	});

	it('reports a malformed answer instead of throwing', () => {
		expect(parseRendeExtraction('not json').balances).toEqual([]);
		expect(parseRendeExtraction('{"balances": 1}').confidence).toBe(0);
	});
});
