import { z } from 'zod';
import { callLlm } from '$lib/server/llm';
import type { FundCandidate } from './investment-registry';

// The investment assistant: answers questions about the portfolio and helps
// register new holdings.
//
// Two boundaries hold this together, and both are enforced here rather than
// asked of the model:
//
//  - It never writes. The most it produces is a proposal, which the caller
//    validates against the CVM registry and the user confirms on screen.
//  - It never composes a CNPJ. Candidates come from the local registry and the
//    model may only pick one of them by index; anything else is dropped. A
//    plausible wrong CNPJ is the dangerous failure here, because it values
//    today's balance correctly and only diverges later.
//
// What it sees is a summary of the household's own investments — the same data
// the pages already render — and nothing else.

export interface PortfolioLine {
	label: string;
	assetClass: string;
	quantity: number;
	value: number;
	averageCost: number | null;
	monthGain: number | null;
	monthReturn: number | null;
}

export interface PortfolioContext {
	today: string;
	totalValue: number;
	lastReconciliation: string | null;
	positions: PortfolioLine[];
	months: {
		month: string;
		gain: number;
		returnRate: number | null;
		cdiRate: number;
		percentOfCdi: number | null;
		unpricedCount: number;
	}[];
	pendingDarf: { month: string; amount: number; dueDate: string }[];
}

const brl = (value: number) =>
	value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (rate: number | null) =>
	rate === null ? 'n/d' : `${(rate * 100).toFixed(2)}%`;

// A compact rendering: the model reasons better over a short table than over
// raw rows, and less data crosses to the provider.
export function renderContext(context: PortfolioContext): string {
	const lines = [
		`Data de hoje: ${context.today}`,
		`Patrimônio total: ${brl(context.totalValue)}`,
		context.lastReconciliation
			? `Última reconciliação com a B3: ${context.lastReconciliation}`
			: 'Nenhuma posição oficial importada ainda.',
		'',
		'Posições (ativo | classe | quantidade | valor | preço médio | rendeu no mês):'
	];
	for (const position of context.positions) {
		lines.push(
			`- ${position.label} | ${position.assetClass} | ${position.quantity} | ${brl(position.value)} | ${
				position.averageCost === null ? 'n/d' : brl(position.averageCost)
			} | ${position.monthGain === null ? 'n/d' : `${brl(position.monthGain)} (${pct(position.monthReturn)})`}`
		);
	}
	if (context.months.length > 0) {
		lines.push('', 'Rendimento mensal da carteira:');
		for (const month of context.months) {
			lines.push(
				`- ${month.month}: ${brl(month.gain)} (${pct(month.returnRate)}), CDI ${pct(month.cdiRate)}, ${
					month.percentOfCdi === null
						? 'n/d'
						: `${month.percentOfCdi.toFixed(0)}% do CDI`
				}${month.unpricedCount > 0 ? ` — ${month.unpricedCount} ativo(s) sem preço no período` : ''}`
			);
		}
	}
	if (context.pendingDarf.length > 0) {
		lines.push('', 'DARF em aberto:');
		for (const darf of context.pendingDarf) {
			lines.push(
				`- ${darf.month}: ${brl(darf.amount)}, vence em ${darf.dueDate}`
			);
		}
	}
	return lines.join('\n');
}

const replySchema = z.object({
	reply: z.string().min(1),
	// Filled only when the user is registering a fund and every number is known.
	proposal: z
		.object({
			candidate_index: z.number().int().nullable().optional(),
			name: z.string().min(1),
			balance: z.number(),
			applied: z.number().nullable().optional(),
			balance_date: z.string().nullable().optional(),
			kind: z.enum(['fundo', 'previdencia']).optional()
		})
		.nullable()
		.optional(),
	// A name to look up in the CVM registry when no candidate fits yet.
	search: z.string().nullable().optional()
});

export interface AssistantProposal {
	cnpj: string;
	subclassId: string;
	registryName: string;
	name: string;
	balance: number;
	applied: number | null;
	balanceDate: string | null;
	kind: 'fundo' | 'previdencia';
}

export interface AssistantReply {
	reply: string;
	proposal: AssistantProposal | null;
	search: string | null;
}

export interface AssistantTurn {
	role: 'user' | 'assistant';
	content: string;
}

function systemPrompt(context: string, candidates: FundCandidate[]): string {
	const candidateBlock =
		candidates.length > 0
			? candidates
					.map(
						(candidate, index) =>
							`${index}: ${candidate.name} | CNPJ ${candidate.cnpj}${
								candidate.subclassId
									? ` | subclasse ${candidate.subclassId}`
									: ''
							}${candidate.previdenciario ? ' | previdenciário' : ''}`
					)
					.join('\n')
			: '(nenhum candidato buscado ainda)';

	return `Você é o assistente de investimentos de um app de finanças pessoais brasileiro. Responda em português, de forma direta e curta. Responda com JSON apenas.

Você pode:
1. Responder perguntas sobre a carteira do usuário, usando SOMENTE os dados abaixo. Se algo não estiver nos dados, diga que não sabe — nunca estime números de mercado, cotações ou rentabilidades que não estejam aqui.
2. Ajudar a cadastrar um fundo ou previdência novo.

Regras do cadastro:
- Você NUNCA escreve um CNPJ. Para identificar um fundo, use o campo "search" com o nome que o usuário deu, e o sistema devolve candidatos reais do cadastro da CVM.
- Quando os candidatos aparecerem, escolha um pelo índice em "candidate_index". Se nenhum servir, peça mais detalhes ou use "search" de novo com outro termo.
- Só preencha "proposal" quando souber o fundo escolhido E o saldo atual. Se faltar saldo, pergunte.
- "applied" é quanto foi investido. Se o usuário informar o rendimento acumulado em vez disso, subtraia do saldo. Se ele só souber o rendimento de um período (12 meses, por exemplo), isso NÃO serve: deixe null e explique.
- Nunca invente saldo, data ou nome.
- Você não altera nem remove nada que já existe; para isso, oriente o usuário às telas do app.

Nada é gravado pela sua resposta: a proposta vai para uma tela de confirmação.

=== DADOS DA CARTEIRA DO USUÁRIO ===
${context}

=== CANDIDATOS DO CADASTRO DA CVM ===
${candidateBlock}

Retorne JSON neste formato exato:
{
  "reply": "sua resposta ao usuário",
  "proposal": null,
  "search": null
}`;
}

export async function askAssistant(
	turns: AssistantTurn[],
	context: PortfolioContext,
	candidates: FundCandidate[]
): Promise<AssistantReply> {
	const response = await callLlm({
		messages: [
			{
				role: 'system',
				content: systemPrompt(renderContext(context), candidates)
			},
			// The API takes user turns only; the assistant's own lines are folded
			// into the transcript so the thread still reads as a conversation.
			{
				role: 'user',
				content: turns
					.map(
						(turn) =>
							`${turn.role === 'user' ? 'Usuário' : 'Assistente'}: ${turn.content}`
					)
					.join('\n')
			}
		],
		json_mode: true
	});
	return parseReply(response.choices[0]?.message?.content ?? '', candidates);
}

export function parseReply(
	content: string,
	candidates: FundCandidate[]
): AssistantReply {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return {
			reply: 'Não consegui interpretar a resposta do modelo. Tente reformular.',
			proposal: null,
			search: null
		};
	}
	const validated = replySchema.safeParse(parsed);
	if (!validated.success) {
		return {
			reply: 'A resposta do modelo veio fora do formato esperado.',
			proposal: null,
			search: null
		};
	}
	const { reply, proposal, search } = validated.data;
	return {
		reply,
		search: search?.trim() ? search.trim() : null,
		proposal: toProposal(proposal ?? null, candidates)
	};
}

function pickCandidate(
	index: number | null | undefined,
	candidates: FundCandidate[]
): FundCandidate | null {
	if (typeof index !== 'number' || index < 0 || index >= candidates.length)
		return null;
	return candidates[index];
}

function nonNegativeNumber(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: null;
}

// The index is the only channel through which a fund identity can enter, so an
// out-of-range or absent one drops the proposal entirely.
function toProposal(
	raw: z.infer<typeof replySchema>['proposal'],
	candidates: FundCandidate[]
): AssistantProposal | null {
	if (!raw) return null;
	const candidate = pickCandidate(raw.candidate_index, candidates);
	if (!candidate) return null;
	if (!Number.isFinite(raw.balance) || raw.balance <= 0) return null;
	const applied = nonNegativeNumber(raw.applied);
	return {
		cnpj: candidate.cnpj,
		subclassId: candidate.subclassId,
		registryName: candidate.name,
		name: raw.name.trim(),
		balance: raw.balance,
		applied,
		balanceDate:
			raw.balance_date && /^\d{4}-\d{2}-\d{2}$/.test(raw.balance_date)
				? raw.balance_date
				: null,
		kind:
			raw.kind === 'previdencia' || candidate.previdenciario
				? 'previdencia'
				: 'fundo'
	};
}
