import type { PageData } from '../../app/$types';

// Invented figures for the dashboard view; only the fields the screen reads
// without a fallback are filled in.
const months = ['2026-07', '2026-08', '2026-09'];

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
		contributions: 1500,
		redemptions: 200,
		investmentIncome: 90,
		net: 1300,
		newCapital: 1210
	},
	profiles: [],
	categories: [],
	monthlyTrend: months.map((month, index) => ({
		month,
		expenses: 4000 + index * 200,
		credits: 6200,
		balance: 2200 - index * 200
	})),
	categoryTrend: {
		months,
		series: [
			{ id: 'c1', name: 'Alimentação' },
			{ id: 'c2', name: 'Moradia' }
		],
		points: months.map((month, index) => ({
			month,
			total: 3000 + index * 100,
			values: { c1: 1500 + index * 100, c2: 1500 }
		}))
	},
	aboveNormal: [
		{
			id: 'c1',
			name: 'Alimentação',
			current: 1850,
			baseline: 1400,
			delta: 450,
			deltaPercent: 32
		}
	],
	savingsHistory: months.map((month, index) => ({
		month,
		credits: 6200,
		expenses: 4000 + index * 200,
		rate: (2200 - index * 200) / 6200
	})),
	fixedVsVariable: {
		fixedTotal: 2100,
		variableTotal: 2720.5,
		topFixed: [
			{ name: 'Aluguel', total: 1600 },
			{ name: 'Streaming', total: 60 }
		]
	},
	installmentForecast: {
		totalCommitted: 2400,
		months: [
			{ month: '2026-10', total: 900, count: 4 },
			{ month: '2026-11', total: 800, count: 3 },
			{ month: '2026-12', total: 700, count: 3 }
		]
	},
	projection: { projected: 5100, baseline: 4500, percentVsBaseline: 13 },
	byProfile: [
		{ id: 'p1', name: 'Pessoal', total: 3200, share: 66 },
		{ id: 'p2', name: 'Casa', total: 1620.5, share: 34 }
	],
	byPayer: [
		{ id: 'u1', name: 'Ana', total: 2900, share: 60 },
		{ id: 'u2', name: 'Bruno', total: 1920.5, share: 40 }
	],
	recentTransactions: [
		{
			id: 't3',
			date: '2026-09-12',
			description: 'Restaurante da Esquina',
			amount: -89.9,
			currency: 'BRL',
			review_status: 'confirmed'
		},
		{
			id: 't4',
			date: '2026-09-11',
			description: 'Salário',
			amount: 6200,
			currency: 'BRL',
			review_status: 'needs_review'
		}
	]
} as unknown as PageData;

// Nothing to show beyond the basics: every optional card must stay hidden.
export const dashboardEmptyData = {
	...dashboardData,
	summary: {
		...summary,
		count: 5,
		needsReview: 0,
		uncategorized: 0,
		refunds: 0
	},
	investmentFlows: {
		contributions: 0,
		redemptions: 0,
		investmentIncome: 0,
		net: 0,
		newCapital: 0
	},
	categoryTrend: { months: ['2026-09'], series: [], points: [] },
	savingsHistory: [],
	fixedVsVariable: { fixedTotal: 0, variableTotal: 0, topFixed: [] },
	installmentForecast: { months: [], totalCommitted: 0 },
	projection: null,
	aboveNormal: [],
	byProfile: [{ id: 'p1', name: 'Pessoal', total: 4820.5, share: 100 }],
	byPayer: []
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
