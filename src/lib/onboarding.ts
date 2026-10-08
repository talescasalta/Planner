// First-run checklist for a fresh instance. The server gathers the facts; the
// steps are derived here so the dashboard can mix in the review count the
// layout already loads.

export type OnboardingFacts = {
	hasGroup: boolean;
	hasOwnNames: boolean;
	transactionCount: number;
	memberCount: number;
	membersWithIncome: number;
};

export type OnboardingStep = {
	id: 'group' | 'names' | 'import' | 'review' | 'member' | 'income';
	label: string;
	description: string;
	href: '/app/groups' | '/app/settings' | '/app/imports' | '/app/review';
	done: boolean;
	optional?: boolean;
};

export function buildOnboardingSteps(
	facts: OnboardingFacts,
	reviewCount: number | null
): OnboardingStep[] {
	const hasTransactions = facts.transactionCount > 0;
	const steps: OnboardingStep[] = [
		{
			id: 'group',
			label: 'Criar o grupo da casa',
			description:
				'Transações, categorias e regras pertencem ao grupo. Quem cria é o administrador.',
			href: '/app/groups',
			done: facts.hasGroup
		},
		{
			id: 'names',
			label: 'Cadastrar os nomes nas suas transferências',
			description:
				'Assim um Pix entre as suas próprias contas não conta como despesa e receita.',
			href: '/app/settings',
			done: facts.hasOwnNames
		},
		{
			id: 'import',
			label: 'Importar a primeira fatura ou extrato',
			description: 'CSV, PDF, print ou texto colado.',
			href: '/app/imports',
			done: hasTransactions
		},
		{
			id: 'review',
			label: 'Revisar as pendências',
			description:
				'Cada correção vira uma regra, e o próximo mês já chega classificado.',
			href: '/app/review',
			done: hasTransactions && reviewCount === 0
		},
		{
			id: 'member',
			label: 'Adicionar quem divide as contas com você',
			description:
				'A pessoa cria a conta dela e você a adiciona pelo e-mail em Grupos.',
			href: '/app/groups',
			done: facts.memberCount > 1,
			optional: true
		}
	];
	if (facts.memberCount > 1) {
		steps.push({
			id: 'income',
			label: 'Preencher a renda de cada membro',
			description:
				'É a base da divisão proporcional das despesas compartilhadas.',
			href: '/app/groups',
			done: facts.membersWithIncome >= facts.memberCount
		});
	}
	return steps;
}
