import { describe, expect, it } from 'vitest';
import { filterCategoriesForUser } from './gabarito';

type Category = {
	id: string;
	name: string;
	parent_id: string | null;
	created_by_user_id: string | null;
};

const categories: Category[] = [
	{ id: 'food', name: 'Alimentação', parent_id: null, created_by_user_id: null },
	{ id: 'bakery', name: 'Padaria', parent_id: 'food', created_by_user_id: null },
	{ id: 'unknown-default', name: 'Categoria legada', parent_id: null, created_by_user_id: null },
	{ id: 'personal', name: 'Meu projeto', parent_id: null, created_by_user_id: 'user-a' },
	{ id: 'personal-child', name: 'Ferramentas', parent_id: 'personal', created_by_user_id: 'user-a' },
	{ id: 'foreign', name: 'Categoria de outra pessoa', parent_id: null, created_by_user_id: 'user-b' }
];

describe('filterCategoriesForUser', () => {
	it('keeps taxonomy categories and the current user personal taxonomy only', () => {
		const visibleIds = filterCategoriesForUser(categories, 'user-a').map((category) => category.id);

		expect(visibleIds).toEqual(['food', 'personal', 'bakery', 'personal-child']);
		expect(visibleIds).not.toContain('unknown-default');
		expect(visibleIds).not.toContain('foreign');
	});

	it('hides an excluded parent and all of its children', () => {
		const visibleIds = filterCategoriesForUser(categories, 'user-a', ['food']).map((category) => category.id);

		expect(visibleIds).not.toContain('food');
		expect(visibleIds).not.toContain('bakery');
	});

	it('temporarily includes a hidden child together with its required parent', () => {
		const visibleIds = filterCategoriesForUser(
			categories,
			'user-a',
			['food', 'bakery'],
			['bakery']
		).map((category) => category.id);

		expect(visibleIds).toContain('food');
		expect(visibleIds).toContain('bakery');
	});
});
