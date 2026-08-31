import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
	collectFundHistory,
	collectTesouroHistory,
	monthsBetween,
	pricesFromYahooChart
} from './investment-history';
import { tesouroMatchKey } from './investment-quotes';
import { fundKey } from './investment-funds';

describe('pricesFromYahooChart', () => {
	// 2026-07-31 and 2026-08-03 at midday UTC.
	const chart = (closes: (number | null)[]) => ({
		chart: {
			result: [
				{
					timestamp: [1785499200, 1785758400, 1785844800].slice(
						0,
						closes.length
					),
					indicators: { quote: [{ close: closes }] }
				}
			]
		}
	});

	it('turns candles into dated closes', () => {
		const prices = pricesFromYahooChart(chart([175.02, 174.5]));
		expect(prices).toHaveLength(2);
		expect(prices[0].price).toBe(175.02);
		expect(prices[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('drops holidays and bad values instead of carrying them', () => {
		expect(pricesFromYahooChart(chart([175.02, null, 0]))).toHaveLength(1);
	});

	it('survives a shape it does not recognize', () => {
		expect(pricesFromYahooChart({})).toEqual([]);
		expect(pricesFromYahooChart({ chart: { result: [] } })).toEqual([]);
	});
});

describe('collectTesouroHistory', () => {
	const key = tesouroMatchKey('Tesouro IPCA+', '2032');
	const line = (date: string, pu: string) =>
		`Tesouro IPCA+;15/08/2032;${date};7,10;7,22;3.500,10;${pu};3.490,00`;

	it('keeps every day, not just the freshest', () => {
		const history = collectTesouroHistory(
			[line('30/06/2026', '2.895,65'), line('31/07/2026', '2.920,94')].join(
				'\n'
			),
			new Set([key]),
			'2026-06-01'
		);
		expect(history.get(key)).toEqual([
			{ date: '2026-06-30', price: 2895.65 },
			{ date: '2026-07-31', price: 2920.94 }
		]);
	});

	it('discards rows older than the requested start', () => {
		const history = collectTesouroHistory(
			[line('31/12/2019', '1.500,00'), line('31/07/2026', '2.920,94')].join(
				'\n'
			),
			new Set([key]),
			'2026-06-01'
		);
		expect(history.get(key)).toHaveLength(1);
	});

	it('ignores other bonds and malformed rows', () => {
		const history = collectTesouroHistory(
			[
				'Tesouro Prefixado;01/01/2029;31/07/2026;13,00;13,10;800,00;790,00;795,00',
				'Tipo Titulo;Data Vencimento;Data Base',
				line('lixo', '2.920,94')
			].join('\n'),
			new Set([key]),
			'2026-01-01'
		);
		expect(history.size).toBe(0);
	});
});

describe('collectFundHistory', () => {
	const KINEA = '29.762.315/0001-58';
	const line = (sub: string, date: string, quota: string) =>
		`CLASSES - FIF;${KINEA};${sub};${date};1095646.22;${quota};1207786.03;0.00;0.00;1`;

	it('collects a subclass series without mixing in its siblings', () => {
		const wanted = new Set([fundKey(KINEA, '30SMU1746554429')]);
		const history = collectFundHistory(
			[
				line('30SMU1746554429', '2026-07-31', '2.902888'),
				line('30SMU1746554429', '2026-08-27', '2.966267'),
				line('M1UAE1770833631', '2026-07-31', '1.021366')
			].join('\n'),
			wanted
		);
		expect(history.size).toBe(1);
		expect(history.get(fundKey(KINEA, '30SMU1746554429'))).toEqual([
			{ date: '2026-07-31', price: 2.902888 },
			{ date: '2026-08-27', price: 2.966267 }
		]);
	});

	it('accumulates across the monthly files', () => {
		const wanted = new Set([fundKey(KINEA, '')]);
		const into = collectFundHistory(line('', '2026-07-31', '2.90'), wanted);
		collectFundHistory(line('', '2026-08-27', '2.97'), wanted, into);
		expect(into.get(fundKey(KINEA, ''))).toHaveLength(2);
	});
});

describe('monthsBetween', () => {
	it('lists every informe file the window touches', () => {
		expect(monthsBetween('2026-06-15', '2026-08-31')).toEqual([
			'202606',
			'202607',
			'202608'
		]);
	});

	it('crosses the year boundary', () => {
		expect(monthsBetween('2025-11-30', '2026-01-05')).toEqual([
			'202511',
			'202512',
			'202601'
		]);
	});

	it('handles a window inside one month', () => {
		expect(monthsBetween('2026-08-01', '2026-08-31')).toEqual(['202608']);
	});
});
