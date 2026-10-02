import type { Transaction } from '$lib/types/app';
import type { TransactionsPageData } from '$lib/types/page-data';
import { categoriesData } from './fixtures';

// Invented rows covering each state the transactions list can render.
function tx(id: string, overrides: Partial<Transaction>): Transaction {
	return {
		id,
		household_id: 'house-demo',
		date: '2026-09-12',
		description: 'COMPRA EXEMPLO',
		clean_description: null,
		merchant: null,
		amount: -42.9,
		currency: 'BRL',
		source_name: 'Cartão Exemplo',
		source_type: 'credit_card',
		installment_number: null,
		installment_total: null,
		installment_group_key: null,
		reference_month: '2026-09',
		paid_by_user_id: null,
		owner_profile_id: null,
		split_method: 'equal',
		category_id: null,
		subcategory_id: null,
		classification_method: 'manual',
		classification_confidence: null,
		review_status: 'confirmed',
		is_transfer: false,
		financial_flow_kind: 'expense',
		classification_suggestion: null,
		created_by_user_id: 'u1',
		created_at: '2026-09-12',
		updated_at: '2026-09-12',
		category_display_name: 'Alimentação',
		subcategory_display_name: 'Supermercado',
		classification_display_source: 'saved',
		...overrides
	} as Transaction;
}

export const transactionsData: TransactionsPageData = {
	transactions: [
		tx('t1', {
			description:
				'MERCADO BOM PRECO LOJA 12 COM DESCRIÇÃO BEM LONGA PARA QUEBRAR',
			amount: -187.35,
			review_status: 'needs_review',
			category_id: null,
			category_display_name: 'Alimentação',
			subcategory_display_name: 'Supermercado',
			classification_display_source: 'suggestion'
		}),
		tx('t2', {
			description: 'Restaurante da Esquina',
			amount: -89.9,
			category_id: 'c1',
			subcategory_id: 'c1b',
			subcategory_display_name: 'Restaurantes e delivery'
		}),
		tx('t3', {
			description: 'COMPRA REPETIDA NO EXTRATO',
			amount: -120,
			review_status: 'ignored',
			source_name: 'Conta Corrente Exemplo',
			source_type: 'bank_account',
			category_display_name: null,
			subcategory_display_name: null,
			classification_display_source: 'empty',
			classification_suggestion: {
				type: 'ignored',
				ignored_reason: 'duplicate',
				reason_code: 'possible_duplicate',
				duplicate_description: 'COMPRA REPETIDA FATURA',
				duplicate_date: '2026-09-11'
			}
		}),
		tx('t4', {
			description: 'PIX ENVIADO PARA CONTA PROPRIA',
			amount: -500,
			review_status: 'needs_review',
			source_name: 'Conta Corrente Exemplo',
			source_type: 'bank_account',
			category_display_name: null,
			subcategory_display_name: null,
			classification_display_source: 'empty',
			financial_flow_kind: 'transfer',
			classification_suggestion: {
				type: 'transfer_pair',
				reason_code: 'transfer_pair',
				pair_id: 'p1',
				pair_description: 'PIX RECEBIDO',
				pair_account: 'Poupança Exemplo'
			}
		}),
		tx('t5', {
			description: 'Salário Empresa Exemplo',
			amount: 6200,
			source_name: 'Conta Corrente Exemplo',
			source_type: 'bank_account',
			category_display_name: 'Moradia',
			subcategory_display_name: null,
			financial_flow_kind: 'income'
		})
	],
	categories: categoriesData.categories,
	profiles: [],
	monthOptions: ['2026-09', '2026-08'],
	selectedMonth: '2026-09',
	accounts: [
		{ name: 'Cartão Exemplo', source_type: 'credit_card' },
		{ name: 'Conta Corrente Exemplo', source_type: 'bank_account' }
	],
	filters: {
		sourceType: 'credit_card',
		account: 'all',
		profileId: '',
		categoryId: '',
		subcategoryId: '',
		status: 'all',
		direction: 'all',
		flow: 'all'
	},
	page: 0,
	pageSize: 50,
	hasMore: false,
	summary: {
		count: 5,
		expenses: 939.15,
		credits: 6200,
		balance: 5260.85,
		contributions: 0,
		redemptions: 0,
		investmentIncome: 0,
		transfers: 500
	}
};
