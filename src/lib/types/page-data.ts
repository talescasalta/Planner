import type { Transaction, Category, FinancialProfile, HouseholdMember } from './app';

export interface TransactionsPageData {
	transactions: Transaction[];
	categories: Category[];
	profiles: FinancialProfile[];
	monthOptions: string[];
	selectedMonth: string;
	page: number;
	pageSize: number;
	hasMore: boolean;
	summary: {
		count: number;
		expenses: number;
		credits: number;
		balance: number;
	};
}

export interface TransactionNewPageData {
	categories: Category[];
	profiles: FinancialProfile[];
	members: HouseholdMember[];
}

export interface TransactionDetailPageData {
	transaction: Transaction;
	editable: boolean;
	categories: Category[];
	profiles: FinancialProfile[];
	members: HouseholdMember[];
}
