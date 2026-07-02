// Projects future credit card installments from the ones already imported.
// Nothing is stored: given the latest known installment "k/n" of a purchase,
// installments k+1..n are projected into the following months. When a later
// statement is imported, its real installment row becomes the new anchor and
// the projection shrinks automatically.

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

export function addMonths(month: string, delta: number): string {
	const [year, m] = month.split('-').map(Number);
	if (!year || !m) return month;
	const base = new Date(Date.UTC(year, m - 1, 1));
	base.setUTCMonth(base.getUTCMonth() + delta);
	const yy = base.getUTCFullYear();
	const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
	return `${yy}-${mm}`;
}

function monthOf(tx: InstallmentSourceTransaction): string {
	if (tx.reference_month && /^\d{4}-\d{2}$/.test(tx.reference_month)) return tx.reference_month;
	return (tx.date ?? '').slice(0, 7);
}

export function projectFutureInstallments(
	transactions: InstallmentSourceTransaction[]
): FutureInstallmentsSummary {
	const groups = new Map<string, InstallmentSourceTransaction[]>();
	for (const tx of transactions) {
		if (!tx.installment_group_key || !tx.installment_total || !tx.installment_number) continue;
		const group = groups.get(tx.installment_group_key) ?? [];
		group.push(tx);
		groups.set(tx.installment_group_key, group);
	}

	const projected: ProjectedInstallment[] = [];
	for (const [groupKey, rows] of groups) {
		// Anchor on the latest known installment; anything past it is still future.
		const anchor = rows.reduce((a, b) =>
			(b.installment_number ?? 0) > (a.installment_number ?? 0) ? b : a
		);
		const anchorNumber = anchor.installment_number as number;
		const total = anchor.installment_total as number;
		if (anchorNumber >= total) continue; // purchase already fully paid

		const anchorMonth = monthOf(anchor);
		if (!/^\d{4}-\d{2}$/.test(anchorMonth)) continue;

		const merchant = (anchor.clean_description || anchor.description || '').trim();
		const categoryName = anchor.category_display_name ?? null;

		for (let j = anchorNumber + 1; j <= total; j++) {
			projected.push({
				groupKey,
				merchant,
				number: j,
				total,
				amount: anchor.amount, // per-installment amount, negative for expenses
				referenceMonth: addMonths(anchorMonth, j - anchorNumber),
				categoryName
			});
		}
	}

	const byMonth = new Map<string, ProjectedInstallment[]>();
	for (const item of projected) {
		const list = byMonth.get(item.referenceMonth) ?? [];
		list.push(item);
		byMonth.set(item.referenceMonth, list);
	}

	const months: InstallmentMonth[] = Array.from(byMonth.entries())
		.map(([month, items]) => ({
			month,
			items: items.sort((a, b) => a.merchant.localeCompare(b.merchant)),
			total: items.reduce((sum, it) => sum + it.amount, 0)
		}))
		.sort((a, b) => a.month.localeCompare(b.month));

	return {
		months,
		total: projected.reduce((sum, item) => sum + item.amount, 0),
		count: projected.length
	};
}
