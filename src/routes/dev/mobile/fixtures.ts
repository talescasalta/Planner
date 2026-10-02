import type { Category, ClassificationRule } from '$lib/types/app';
import type { FutureInstallmentsSummary } from '$lib/types/installments';
import type { LayoutData } from '../../app/$types';

// Invented data only: nothing here comes from a real account.
export const layoutData = {
	session: null,
	user: null,
	profile: null,
	reviewCount: 47
} as unknown as LayoutData;

function category(
	id: string,
	name: string,
	parentId: string | null,
	overrides: Partial<Category> = {}
): Category {
	return {
		id,
		household_id: 'house-demo',
		name,
		parent_id: parentId,
		created_by_user_id: null,
		is_default: true,
		financial_treatment: null,
		created_at: '2026-01-01',
		...overrides
	};
}

export const categoriesData = {
	categories: [
		category('c1', 'Alimentação', null),
		category('c1a', 'Supermercado', 'c1'),
		category('c1b', 'Restaurantes e delivery', 'c1', {
			financial_treatment: 'operating'
		}),
		category('c2', 'Moradia', null, { created_by_user_id: 'u1' }),
		category('c3', 'Transporte', null),
		category('c3a', 'Aplicativos de corrida', 'c3')
	],
	hiddenCategories: [
		category('c9', 'Pets', null),
		category('c9a', 'Ração', 'c9')
	]
};

function rule(
	id: string,
	pattern: string,
	overrides: Partial<ClassificationRule> = {}
): ClassificationRule {
	return {
		id,
		household_id: 'house-demo',
		pattern,
		pattern_type: 'merchant_contains',
		category_id: 'c1',
		subcategory_id: null,
		owner_profile_id: null,
		confidence: 0.9,
		reinforcement_count: 3,
		created_by_user_id: 'u1',
		active: true,
		created_at: '2026-01-01',
		category: category('c1', 'Alimentação', null),
		subcategory: null,
		owner_profile: null,
		...overrides
	};
}

export const rulesData = {
	rules: [
		rule('r1', 'MERCADO BOM PRECO'),
		rule('r2', 'padaria do bairro com nome bastante comprido para quebrar', {
			pattern_type: 'description_contains',
			subcategory: category('c1a', 'Supermercado', 'c1'),
			active: false
		}),
		rule('r3', '^APP CORRIDA.*', {
			pattern_type: 'regex',
			category: category('c3', 'Transporte', null),
			owner_profile: {
				id: 'p1',
				household_id: 'house-demo',
				user_id: null,
				name: 'Casa',
				type: 'shared',
				created_at: '2026-01-01'
			}
		})
	],
	categories: categoriesData.categories,
	profiles: []
};

export const installmentsData: FutureInstallmentsSummary = {
	total: 1250.4,
	count: 3,
	months: [
		{
			month: '2026-11',
			total: 850.4,
			items: [
				{
					groupKey: 'g1',
					merchant: 'Loja de Eletrônicos Exemplo',
					number: 4,
					total: 10,
					amount: 650.4,
					referenceMonth: '2026-11',
					categoryName: 'Compras'
				},
				{
					groupKey: 'g2',
					merchant: 'Academia',
					number: 2,
					total: 6,
					amount: 200,
					referenceMonth: '2026-11',
					categoryName: null
				}
			]
		},
		{
			month: '2026-12',
			total: 400,
			items: [
				{
					groupKey: 'g3',
					merchant: 'Curso online',
					number: 5,
					total: 8,
					amount: 400,
					referenceMonth: '2026-12',
					categoryName: 'Educação'
				}
			]
		}
	]
};
