export interface InstallmentSourceTransaction {
	installment_number: number | null;
	installment_total: number | null;
	installment_group_key: string | null;
	amount: number;
	reference_month: string | null;
	date: string;
	clean_description: string | null;
	description: string;
	category_display_name?: string | null;
}

export interface ProjectedInstallment {
	groupKey: string;
	merchant: string;
	number: number;
	total: number;
	amount: number;
	referenceMonth: string;
	categoryName: string | null;
}

export interface InstallmentMonth {
	month: string;
	total: number;
	items: ProjectedInstallment[];
}

export interface FutureInstallmentsSummary {
	months: InstallmentMonth[];
	total: number;
	count: number;
}
