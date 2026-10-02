import type { FinancialFlowKind, FinancialTreatment } from '$lib/types/app';

export const TREATMENT_OPTIONS: ReadonlyArray<{
	value: FinancialTreatment;
	label: string;
}> = [
	{ value: 'operating', label: 'Operacional (despesa/reembolso)' },
	{ value: 'income', label: 'Renda do trabalho' },
	{ value: 'investment', label: 'Investimento (aporte/resgate)' },
	{ value: 'investment_income', label: 'Proventos/rendimentos' },
	{ value: 'transfer', label: 'Transferência' }
];

const FLOW_LABELS: Record<FinancialFlowKind, string> = {
	income: 'Receita',
	expense: 'Despesa',
	refund: 'Reembolso',
	contribution: 'Aporte',
	redemption: 'Resgate',
	investment_income: 'Provento',
	transfer: 'Transferência',
	excluded: 'Ignorado'
};

export function flowKindLabel(kind: string | null | undefined, fallback = '—') {
	return (kind && FLOW_LABELS[kind as FinancialFlowKind]) || fallback;
}
