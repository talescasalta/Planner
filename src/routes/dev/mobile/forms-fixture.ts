import type { TransactionNewPageData } from '$lib/types/page-data';
import type { ActionData, PageData } from '../../app/imports/$types';
import { categoriesData } from './fixtures';

// Invented data for the manual-entry and import-preview views.
export const newTransactionData = {
	categories: categoriesData.categories,
	profiles: [
		{
			id: 'p1',
			household_id: 'house-demo',
			user_id: null,
			name: 'Casa',
			type: 'shared',
			created_at: '2026-01-01'
		}
	],
	members: [{ user_id: 'u1', profiles: { display_name: 'Pessoa Exemplo' } }]
} as unknown as TransactionNewPageData;

export const importsData = {
	accounts: [],
	coverage: { months: [], rows: [] }
} as unknown as PageData;

// A filled preview, as the `preview` action would return it.
export const importsForm = {
	success: true,
	total: 3,
	duplicates: 1,
	possible_duplicates: [],
	filename: 'fatura-exemplo.csv',
	mapping_source: 'deterministic',
	mapping_confidence: 1,
	mapping_notes: '',
	reference_month: '2026-09',
	source_type: 'credit_card',
	account_name: 'Cartão Exemplo',
	preview_token: 'demo-token',
	preview: [
		{
			date: '2026-09-02',
			description: 'MERCADO BOM PRECO LOJA 12',
			clean_description: 'MERCADO BOM PRECO',
			amount: -187.35,
			duplicate: false
		},
		{
			date: '2026-09-03',
			description: 'RESTAURANTE DA ESQUINA',
			clean_description: 'RESTAURANTE DA ESQUINA',
			amount: -89.9,
			duplicate: true
		},
		{
			date: '2026-09-05',
			description: 'ASSINATURA STREAMING EXEMPLO',
			clean_description: 'ASSINATURA STREAMING EXEMPLO',
			amount: -39.9,
			duplicate: false
		}
	]
} as unknown as ActionData;
