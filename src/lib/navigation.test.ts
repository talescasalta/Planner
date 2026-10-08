import { describe, expect, it } from 'vitest';
import {
	BOTTOM_BAR_ITEMS,
	NAV_ITEMS,
	NAV_SECTIONS,
	isActive
} from './navigation';

describe('isActive', () => {
	it('matches the dashboard only exactly', () => {
		expect(isActive('/app', '/app')).toBe(true);
		expect(isActive('/app/transactions', '/app')).toBe(false);
	});

	it('matches a section and its children', () => {
		expect(isActive('/app/transactions', '/app/transactions')).toBe(true);
		expect(isActive('/app/transactions/abc', '/app/transactions')).toBe(true);
	});

	it('does not match sibling routes sharing a prefix', () => {
		expect(isActive('/app/transactions-old', '/app/transactions')).toBe(false);
		expect(isActive('/app/rules', '/app/review')).toBe(false);
	});
});

describe('NAV_ITEMS', () => {
	it('has the four primary items in bottom-bar order', () => {
		expect(BOTTOM_BAR_ITEMS.map((i) => i.href)).toEqual([
			'/app',
			'/app/transactions',
			'/app/investments',
			'/app/review'
		]);
		expect(NAV_ITEMS.filter((i) => i.primary)).toHaveLength(4);
	});

	it('gives every section at least one item', () => {
		for (const section of NAV_SECTIONS) {
			expect(NAV_ITEMS.some((i) => i.section === section.id)).toBe(true);
		}
	});

	it('keeps each item in a known section, grouped in section order', () => {
		const order = NAV_SECTIONS.map((s) => s.id);
		const positions = NAV_ITEMS.map((i) => order.indexOf(i.section));
		expect(positions.every((p) => p >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});
});
