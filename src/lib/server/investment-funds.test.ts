import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
	collectLatestQuotes,
	formatCnpj,
	fundKey,
	informeMonths,
	onlyDigits,
	parseInformeLine
} from './investment-funds';

// Rows copied from the real CVM informe diário (August 2026), including the
// four subclasses Kinea Atlas II publishes under one CNPJ.
const KINEA = '29.762.315/0001-58';
const linha = (cnpj: string, sub: string, date: string, quota: string) =>
	`CLASSES - FIF;${cnpj};${sub};${date};1095646.22;${quota};1207786.03;0.00;0.00;1`;

describe('fund identity', () => {
	it('normalizes CNPJ punctuation both ways', () => {
		expect(onlyDigits(KINEA)).toBe('29762315000158');
		expect(formatCnpj('29762315000158')).toBe(KINEA);
		expect(formatCnpj('123')).toBe('123');
	});

	it('treats CNPJ plus subclass as the identity', () => {
		expect(fundKey(KINEA, '30SMU1746554429')).toBe(
			'29762315000158|30SMU1746554429'
		);
		// Same fund, different subclass: different series.
		expect(fundKey(KINEA, '30SMU1746554429')).not.toBe(
			fundKey(KINEA, 'M1UAE1770833631')
		);
		expect(fundKey(KINEA, null)).toBe(fundKey(KINEA, '  '));
	});
});

describe('parseInformeLine', () => {
	it('reads CNPJ, subclass, date and quota', () => {
		const quote = parseInformeLine(
			linha('29.762.315/0001-58', '30SMU1746554429', '2026-08-27', '2.966267')
		);
		expect(quote).toEqual({
			key: '29762315000158|30SMU1746554429',
			date: '2026-08-27',
			quota: 2.966267
		});
	});

	it('rejects headers, short rows and unusable values', () => {
		expect(
			parseInformeLine(
				'TP_FUNDO_CLASSE;CNPJ_FUNDO_CLASSE;ID_SUBCLASSE;DT_COMPTC;VL_TOTAL;VL_QUOTA'
			)
		).toBeNull();
		expect(parseInformeLine('')).toBeNull();
		expect(parseInformeLine(linha(KINEA, '', '27/08/2026', '2.96'))).toBeNull();
		expect(parseInformeLine(linha(KINEA, '', '2026-08-27', '0'))).toBeNull();
		expect(parseInformeLine(linha('123', '', '2026-08-27', '2.96'))).toBeNull();
	});
});

describe('collectLatestQuotes', () => {
	it('keeps the freshest quota per fund and ignores unwanted ones', () => {
		const wanted = new Set([fundKey(KINEA, '30SMU1746554429')]);
		const csv = [
			linha(KINEA, '30SMU1746554429', '2026-08-25', '2.962201'),
			linha(KINEA, '30SMU1746554429', '2026-08-27', '2.966267'),
			// Another subclass of the same CNPJ: must not leak in.
			linha(KINEA, 'M1UAE1770833631', '2026-08-27', '1.043136'),
			linha('30.190.210/0001-50', '', '2026-08-27', '210.053558')
		].join('\n');
		const quotes = collectLatestQuotes(csv, wanted);
		expect(quotes.size).toBe(1);
		expect(quotes.get(fundKey(KINEA, '30SMU1746554429'))).toMatchObject({
			date: '2026-08-27',
			quota: 2.966267
		});
	});

	it('accumulates across files without losing the newest', () => {
		const wanted = new Set([fundKey(KINEA, '')]);
		const into = collectLatestQuotes(
			linha(KINEA, '', '2026-07-31', '2.90'),
			wanted
		);
		collectLatestQuotes(linha(KINEA, '', '2026-08-27', '2.97'), wanted, into);
		expect(into.get(fundKey(KINEA, ''))?.quota).toBe(2.97);
	});

	it('turns a balance into quotas the way the form does', () => {
		const wanted = new Set([fundKey('30.190.210/0001-50', '')]);
		const quotes = collectLatestQuotes(
			linha('30.190.210/0001-50', '', '2026-08-27', '210.053558'),
			wanted
		);
		const quota = quotes.get(fundKey('30.190.210/0001-50', ''))!.quota;
		expect(51885.33 / quota).toBeCloseTo(247.01, 2);
	});
});

describe('informeMonths', () => {
	it('asks for the current month and the previous one', () => {
		expect(informeMonths(new Date('2026-08-31T00:00:00Z'))).toEqual([
			'202608',
			'202607'
		]);
	});

	it('rolls back across the year boundary', () => {
		expect(informeMonths(new Date('2026-01-05T00:00:00Z'), 3)).toEqual([
			'202601',
			'202512',
			'202511'
		]);
	});
});
