export type ClassificationMethod =
	'manual' | 'rule' | 'llm' | 'system' | 'imported' | 'unknown';
export type ReviewStatus = 'needs_review' | 'confirmed' | 'ignored';
export type ImportStatus =
	'uploaded' | 'parsed' | 'classified' | 'reviewed' | 'failed';
export type PatternType =
	'merchant_contains' | 'description_contains' | 'exact_merchant' | 'regex';
export type FinancialProfileType = 'individual' | 'shared';
export type SplitMethod = 'income_proportional' | 'equal';
export type TransactionSourceType =
	'credit_card' | 'bank_account' | 'vale_alimentacao' | 'vale_refeicao';

export interface SuccessfulClassificationSuggestion {
	type?: 'classification';
	category: string;
	subcategory?: string | null;
	owner_profile?: string | null;
	confidence: number;
	needs_review: boolean;
	reason_code?: string;
}

export interface ErrorClassificationSuggestion {
	type?: 'error';
	error: string;
	raw?: string;
	message?: string;
}

export interface IgnoredClassificationSuggestion {
	type?: 'ignored';
	ignored_reason: string;
	reason_code?: string;
}

export type ClassificationSuggestion =
	| SuccessfulClassificationSuggestion
	| ErrorClassificationSuggestion
	| IgnoredClassificationSuggestion;

export interface Profile {
	id: string;
	user_id: string;
	display_name: string | null;
	created_at: string;
}

export interface Household {
	id: string;
	name: string;
	created_at: string;
}

export interface HouseholdMember {
	id: string;
	household_id: string;
	user_id: string;
	role: string;
	monthly_income: number;
	created_at: string;
	display_name?: string | null;
	profiles?: { display_name: string | null };
}

export interface FinancialProfile {
	id: string;
	household_id: string;
	user_id: string | null;
	name: string;
	type: FinancialProfileType;
	created_at: string;
}

export interface Category {
	id: string;
	household_id: string;
	name: string;
	parent_id: string | null;
	created_by_user_id: string | null;
	is_default: boolean;
	created_at: string;
}

export interface Transaction {
	id: string;
	household_id: string;
	date: string;
	description: string;
	clean_description: string | null;
	merchant: string | null;
	amount: number;
	currency: string;
	source_name: string | null;
	source_type: TransactionSourceType | null;
	installment_number: number | null;
	installment_total: number | null;
	installment_group_key: string | null;
	reference_month: string | null;
	paid_by_user_id: string | null;
	owner_profile_id: string | null;
	split_method: SplitMethod;
	category_id: string | null;
	subcategory_id: string | null;
	classification_method: ClassificationMethod;
	classification_confidence: number | null;
	review_status: ReviewStatus;
	classification_suggestion: ClassificationSuggestion | null;
	created_by_user_id: string;
	created_at: string;
	updated_at: string;
	// joined fields
	category?: Category | null;
	subcategory?: Category | null;
	owner_profile?: FinancialProfile | null;
	paid_by?: Profile | null;
	// display helpers for transaction list
	category_display_name?: string | null;
	subcategory_display_name?: string | null;
	classification_display_source?: 'saved' | 'suggestion' | 'empty';
}

export interface TransactionAccess {
	id: string;
	transaction_id: string;
	user_id: string;
	can_read: boolean;
	can_edit: boolean;
	created_at: string;
}

export interface ClassificationRule {
	id: string;
	household_id: string;
	pattern: string;
	pattern_type: PatternType;
	category_id: string | null;
	subcategory_id: string | null;
	owner_profile_id: string | null;
	confidence: number;
	reinforcement_count: number;
	created_by_user_id: string;
	active: boolean;
	created_at: string;
	// joined fields
	category?: Category | null;
	subcategory?: Category | null;
	owner_profile?: FinancialProfile | null;
}

export interface TransactionImport {
	id: string;
	household_id: string;
	created_by_user_id: string;
	source_filename: string;
	source_type: TransactionSourceType | null;
	status: ImportStatus;
	row_count: number | null;
	created_at: string;
}

export interface ClassificationJob {
	id: string;
	household_id: string;
	created_by_user_id: string;
	status: string;
	model: string | null;
	input_count: number | null;
	success_count: number | null;
	failed_count: number | null;
	created_at: string;
	finished_at: string | null;
}

export interface AuditEvent {
	id: string;
	household_id: string;
	user_id: string | null;
	event_type: string;
	entity_type: string;
	entity_id: string | null;
	metadata: Record<string, unknown>;
	created_at: string;
}
