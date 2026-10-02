import type {
	Transaction,
	Category,
	FinancialProfile,
	HouseholdMember
} from './app';

export interface TransactionsPageData {
	transactions: Transaction[];
	categories: Category[];
	profiles: FinancialProfile[];
	monthOptions: string[];
	selectedMonth: string;
	/** Accounts the household has imported from, for the account filter. */
	accounts: Array<{ name: string; source_type: string | null }>;
	filters: {
		sourceType: string;
		/** Account name, '__none__' for rows without one, or 'all'. */
		account: string;
		profileId: string;
		categoryId: string;
		subcategoryId: string;
		status: string;
		/** 'in' (só receitas), 'out' (só despesas) ou 'all'. */
		direction: string;
		/** Categorized flow; unlike direction, excludes investment/transfer ambiguity. */
		flow: string;
	};
	page: number;
	pageSize: number;
	hasMore: boolean;
	summary: {
		count: number;
		expenses: number;
		credits: number;
		balance: number;
		contributions: number;
		redemptions: number;
		investmentIncome: number;
		transfers: number;
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
