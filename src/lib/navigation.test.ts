import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isActive } from './navigation';

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
		expect(NAV_ITEMS.filter((i) => i.primary).map((i) => i.href)).toEqual([
			'/app',
			'/app/transactions',
			'/app/imports',
			'/app/review'
		]);
	});
});
