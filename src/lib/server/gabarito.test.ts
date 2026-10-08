import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filterCategoriesForUser, loadGabarito } from './gabarito';

type Category = {
	id: string;
	name: string;
	parent_id: string | null;
	created_by_user_id: string | null;
};

const categories: Category[] = [
	{
		id: 'food',
		name: 'Alimentação',
		parent_id: null,
		created_by_user_id: null
	},
	{
		id: 'bakery',
		name: 'Padaria',
		parent_id: 'food',
		created_by_user_id: null
	},
	{
		id: 'unknown-default',
		name: 'Categoria legada',
		parent_id: null,
		created_by_user_id: null
	},
	{
		id: 'personal',
		name: 'Meu projeto',
		parent_id: null,
		created_by_user_id: 'user-a'
	},
	{
		id: 'personal-child',
		name: 'Ferramentas',
		parent_id: 'personal',
		created_by_user_id: 'user-a'
	},
	{
		id: 'foreign',
		name: 'Categoria de outra pessoa',
		parent_id: null,
		created_by_user_id: 'user-b'
	}
];

describe('filterCategoriesForUser', () => {
	it('keeps taxonomy categories and the current user personal taxonomy only', () => {
		const visibleIds = filterCategoriesForUser(categories, 'user-a').map(
			(category) => category.id
		);

		expect(visibleIds).toEqual([
			'food',
			'personal',
			'bakery',
			'personal-child'
		]);
		expect(visibleIds).not.toContain('unknown-default');
		expect(visibleIds).not.toContain('foreign');
	});

	it('hides an excluded parent and all of its children', () => {
		const visibleIds = filterCategoriesForUser(categories, 'user-a', [
			'food'
		]).map((category) => category.id);

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

describe('seed_default_categories', () => {
	// The seed must create exactly the pairs the CSV makes visible: anything
	// else is a hidden row, anything missing is a category nobody can pick.
	it('seeds the same category pairs as the gabarito CSV', () => {
		const dir = 'supabase/migrations';
		const latest = readdirSync(dir)
			.filter((name) => name.endsWith('.sql'))
			.sort()
			.map((name) => readFileSync(`${dir}/${name}`, 'utf8'))
			.filter((sql) => sql.includes('FUNCTION public.seed_default_categories'))
			.at(-1);
		const body = latest?.split('$$')[1] ?? '';
		const seeded = new Set(
			[...body.matchAll(/\('([^']+)', '([^']+)'\)/g)].map(
				([, parent, child]) => `${parent}|${child}`
			)
		);
		const csv = new Set(
			loadGabarito().map((e) => `${e.categoria}|${e.subcategoria}`)
		);

		expect([...seeded].sort()).toEqual([...csv].sort());
	});
});
