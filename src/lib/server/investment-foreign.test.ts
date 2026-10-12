import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import { accruedNativePrice, foreignQuoteSeries } from './investment-foreign';
import { fetchFxRates, fxOn, isForeignCurrency } from './fx-rates';
import { unitsOn } from './wise-persist';

const anchor = { date: '2026-09-01', nativePrice: 100 };

describe('accruedNativePrice', () => {
	it('compounds the declared annual rate by calendar day', () => {
		expect(accruedNativePrice(anchor, 3.65, '2027-09-01')).toBeCloseTo(
			103.65,
			8
		);
		expect(accruedNativePrice(anchor, 3.65, '2026-09-02')).toBeCloseTo(
			100 * 1.0365 ** (1 / 365),
			10
		);
	});

	it('stays flat without a rate', () => {
		expect(accruedNativePrice(anchor, null, '2026-12-01')).toBe(100);
		expect(accruedNativePrice(anchor, 0, '2026-12-01')).toBe(100);
	});
});

describe('foreignQuoteSeries', () => {
	const fx = [
		{ date: '2026-09-01', rate: 5 },
		{ date: '2026-09-04', rate: 5.5 },
		{ date: '2026-09-02', rate: 5.2 },
		{ date: '2026-09-10', rate: 6 }
	];

	it('prices each PTAX day after the anchor, through the given day', () => {
		const series = foreignQuoteSeries(anchor, null, fx, '2026-09-05');
		expect(series).toEqual([
			{ date: '2026-09-02', nativePrice: 100, price: 520 },
			{ date: '2026-09-04', nativePrice: 100, price: 550 }
		]);
	});

	it('converts the accrued quota, not the anchor', () => {
		const [first] = foreignQuoteSeries(anchor, 10, fx, '2026-09-02');
		expect(first.nativePrice).toBeGreaterThan(100);
		expect(first.price).toBeCloseTo(first.nativePrice * 5.2, 10);
	});
});

describe('PTAX helpers', () => {
	const rates = [
		{ date: '2026-09-04', rate: 5.4 },
		{ date: '2026-09-03', rate: 5.3 }
	];

	it('uses the last business day for weekends and holidays', () => {
		expect(fxOn(rates, '2026-09-06')).toBe(5.4);
		expect(fxOn(rates, '2026-09-03')).toBe(5.3);
		expect(fxOn(rates, '2026-09-02')).toBeNull();
	});

	it('only knows the currencies it has a series for', () => {
		expect(isForeignCurrency('USD')).toBe(true);
		expect(isForeignCurrency('BRL')).toBe(false);
		expect(isForeignCurrency('toString')).toBe(false);
	});

	it('asks SGS for the PTAX series of the currency', async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify([
					{ data: '01/09/2026', valor: '5.4321' },
					{ data: '02/09/2026', valor: '0' }
				])
			)
		);
		await expect(
			fetchFxRates('USD', '2026-09-01', '2026-09-02', fetcher)
		).resolves.toEqual([{ date: '2026-09-01', rate: 5.4321 }]);
		expect(String(fetcher.mock.calls[0][0])).toContain(
			'bcdata.sgs.1/dados?formato=json&dataInicial=01/09/2026&dataFinal=02/09/2026'
		);
	});
});

describe('unitsOn', () => {
	it('adds purchases and subtracts redemptions up to the date', () => {
		const events = [
			{ event_date: '2026-09-01', direction: 'credit', quantity: 10 },
			{ event_date: '2026-09-05', direction: 'debit', quantity: 3 },
			{ event_date: '2026-09-09', direction: 'credit', quantity: 1 }
		];
		expect(unitsOn(events, '2026-08-31')).toBe(0);
		expect(unitsOn(events, '2026-09-05')).toBe(7);
		expect(unitsOn(events, '2026-09-30')).toBe(8);
	});
});
