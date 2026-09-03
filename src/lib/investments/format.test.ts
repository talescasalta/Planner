import { describe, expect, it } from 'vitest';
import {
	brlCompact,
	cdiClass,
	dateBr,
	gainClass,
	monthName,
	monthShort,
	pct,
	percentOfCdi,
	signedBrl,
	signedPct
} from './format';

const nbsp = (text: string) => text.replace(/\u00a0/g, ' ');

describe('signedBrl', () => {
	it('prefixes gains with a plus and keeps the minus on losses', () => {
		expect(nbsp(signedBrl(1234.5))).toBe('+R$ 1.234,50');
		expect(nbsp(signedBrl(-1234.5))).toBe('-R$ 1.234,50');
		expect(nbsp(signedBrl(0))).toBe('R$ 0,00');
	});
});

describe('brlCompact', () => {
	it('abbreviates only from ten thousand up', () => {
		expect(nbsp(brlCompact(9_999.99))).toBe('R$ 9.999,99');
		expect(nbsp(brlCompact(1_475_604))).toBe('R$ 1,48 mi');
		expect(nbsp(brlCompact(22_018))).toBe('R$ 22,02 mil');
	});
});

describe('percentages', () => {
	it('formats rates and handles missing values', () => {
		expect(pct(0.0201)).toBe('2.01%');
		expect(pct(null)).toBe('—');
		expect(signedPct(0.0201)).toBe('+2.01%');
		expect(signedPct(-0.0032)).toBe('-0.32%');
		expect(percentOfCdi(214.4)).toBe('214% do CDI');
		expect(percentOfCdi(null)).toBe('—');
	});
});

describe('dates', () => {
	it('renders month keys and ISO dates in Portuguese', () => {
		expect(monthName('2026-08')).toBe('Agosto de 2026');
		expect(monthShort('2026-08')).toBe('Ago/26');
		expect(dateBr('2026-08-31')).toBe('31/08/2026');
		expect(dateBr(null)).toBe('—');
	});
});

describe('color classes', () => {
	it('colors gains by direction and treats near-zero as neutral', () => {
		expect(gainClass(10)).toBe('text-emerald-700');
		expect(gainClass(-10)).toBe('text-red-700');
		expect(gainClass(0.001)).toBe('text-gray-600');
		expect(gainClass(null)).toBe('text-gray-400');
	});

	it('colors % of CDI against the benchmark', () => {
		expect(cdiClass(120)).toBe('text-emerald-700');
		expect(cdiClass(60)).toBe('text-amber-700');
		expect(cdiClass(-5)).toBe('text-red-700');
		expect(cdiClass(null)).toBe('text-gray-400');
	});
});
