import type { PageData } from '../../app/$types';

// Invented figures for the dashboard view; only the fields the screen reads
// without a fallback are filled in.
const summary = {
	count: 42,
	expenses: 4820.5,
	refunds: 120,
	credits: 6200,
	balance: 1379.5,
	needsReview: 7,
	uncategorized: 3
};

export const dashboardData = {
	monthOptions: ['2026-09', '2026-08'],
	selectedMonth: '2026-09',
	previousMonth: '2026-08',
	summary,
	previousSummary: { ...summary, expenses: 4300 },
	totalExpenses: 4820.5,
	expenseHierarchy: [
		{
			id: 'c1',
			name: 'Alimentação',
			total: 1850,
			children: [
				{ id: 'c1a', name: 'Supermercado', total: 1100 },
				{ id: 'c1b', name: 'Restaurantes e delivery', total: 750 }
			]
		},
		{ id: 'c2', name: 'Moradia', total: 1600, children: [] },
		{
			id: 'c3',
			name: 'Transporte',
			total: 720.5,
			children: [{ id: 'c3a', name: 'Aplicativos de corrida', total: 720.5 }]
		},
		{ id: 'c4', name: 'Lazer', total: 400, children: [] },
		{ id: 'c5', name: 'Saúde', total: 250, children: [] }
	],
	filteredTransactions: [
		{
			id: 't1',
			date: '2026-09-03',
			description: 'MERCADO BOM PRECO',
			amount: -420.3,
			currency: 'BRL',
			category_id: 'c1',
			subcategory_id: 'c1a'
		},
		{
			id: 't2',
			date: '2026-09-10',
			description: 'Supermercado do Bairro',
			amount: -310.15,
			currency: 'BRL',
			category_id: 'c1',
			subcategory_id: 'c1a'
		},
		{
			id: 't3',
			date: '2026-09-12',
			description: 'Restaurante da Esquina',
			amount: -89.9,
			currency: 'BRL',
			category_id: 'c1',
			subcategory_id: 'c1b'
		}
	],
	investmentFlows: {
		contributions: 0,
		redemptions: 0,
		investmentIncome: 0,
		net: 0,
		newCapital: 0
	},
	profiles: [],
	categories: []
} as unknown as PageData;

export const appliedVsGrossData = [
	'2026-01',
	'2026-02',
	'2026-03',
	'2026-04',
	'2026-05',
	'2026-06',
	'2026-07',
	'2026-08',
	'2026-09',
	'2026-10',
	'2026-11',
	'2026-12'
].map((month, index) => ({
	month,
	applied: 10000 + index * 1500,
	gross: 10000 + index * 1500 + index * index * 40
}));
