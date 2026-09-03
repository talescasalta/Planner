import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import { loadCdiRates } from '$lib/server/investment-cdi';
import { monthReturn, recentMonths } from '$lib/server/investment-monthly';
import {
	loadInvestmentRows,
	lastSnapshotDate,
	valuePositions
} from '$lib/server/investment-overview';
import { computeTaxReport, type TaxAssetRow } from '$lib/server/investment-tax';
import {
	askAssistant,
	type AssistantTurn,
	type PortfolioContext
} from '$lib/server/investment-assistant';
import {
	searchFunds,
	type FundCandidate
} from '$lib/server/investment-registry';
import { checkPersistentRateLimit } from '$lib/server/rate-limit';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	LLM_RATE_LIMIT,
	LLM_RATE_LIMIT_MESSAGE,
	MAX_QUESTION_CHARS,
	clampText
} from '$lib/server/request-guards';

// Builds the only view of the household's data the assistant ever sees: the
// same figures the pages render, summarized. Nothing else is sent out.
async function buildContext(
	supabase: Parameters<typeof getUserHouseholdId>[0],
	householdId: string
): Promise<PortfolioContext> {
	const [rows, darfRes] = await Promise.all([
		loadInvestmentRows(supabase, householdId),
		supabase
			.from('investment_darf_status')
			.select('reference_month, paid')
			.eq('household_id', householdId)
	]);
	const { assets, snapshots, events, quotes } = rows;
	const today = new Date().toISOString().slice(0, 10);

	const months = recentMonths(today, 3);
	const rates = await loadCdiRates(`${months.at(-1)}-01`, today);
	const assetIds = assets.map((asset) => asset.id);
	const computed = months.map((month) =>
		monthReturn(assetIds, month, today, snapshots, events, quotes, rates)
	);
	const currentMonth = computed[0];
	const gainByAsset = new Map(
		(currentMonth?.assets ?? []).map((asset) => [asset.assetId, asset])
	);

	const taxReport = computeTaxReport(assets as TaxAssetRow[], events);
	const averageCost = new Map(
		taxReport.costs.map((cost) => [cost.assetId, cost.averageCost])
	);
	const paidMonths = new Set(
		(darfRes.data ?? [])
			.filter((row) => row.paid)
			.map((row) => (row.reference_month as string).slice(0, 7))
	);

	const assetById = new Map(assets.map((asset) => [asset.id, asset]));
	const positions = valuePositions(rows)
		.map(({ assetId, quantity, value }) => {
			const asset = assetById.get(assetId)!;
			const monthly = gainByAsset.get(asset.id);
			return {
				label: asset.ticker ?? asset.name,
				assetClass: asset.asset_class,
				quantity,
				value,
				averageCost: averageCost.get(asset.id) ?? null,
				monthGain: monthly && !monthly.unpriced ? monthly.gain : null,
				monthReturn: monthly && !monthly.unpriced ? monthly.returnRate : null
			};
		})
		.filter((position) => position.quantity > 0)
		.sort((a, b) => b.value - a.value);

	return {
		today,
		totalValue: positions.reduce((sum, position) => sum + position.value, 0),
		lastReconciliation: lastSnapshotDate(snapshots),
		positions,
		months: computed.map((month) => ({
			month: month.month,
			gain: month.gain,
			returnRate: month.returnRate,
			cdiRate: month.cdiRate,
			percentOfCdi: month.percentOfCdi,
			unpricedCount: month.unpricedCount
		})),
		pendingDarf: taxReport.months
			.filter((month) => month.darfAmount > 0 && !paidMonths.has(month.month))
			.map((month) => ({
				month: month.month,
				amount: month.darfAmount,
				dueDate: month.dueDate
			}))
	};
}

// Bounded in both turns and characters so a long (or crafted) thread cannot
// grow the prompt without limit. The history is client-held, so it is treated
// as untrusted text, never as prior instructions.
const MAX_HISTORY_TURNS = 10;
const MAX_TURN_CHARS = 4_000;

function readHistory(raw: string | undefined): AssistantTurn[] {
	try {
		const parsed = JSON.parse(raw || '[]');
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(turn): turn is AssistantTurn =>
					(turn?.role === 'user' || turn?.role === 'assistant') &&
					typeof turn?.content === 'string'
			)
			.slice(-MAX_HISTORY_TURNS)
			.map((turn) => ({
				role: turn.role,
				content: clampText(turn.content, MAX_TURN_CHARS)
			}));
	} catch {
		return [];
	}
}

// Everything that can refuse a question before any LLM call is made.
async function admitQuestion(
	userId: string,
	formData: FormData
): Promise<{ question: string } | { status: number; message: string }> {
	const question = (formData.get('question')?.toString() ?? '').trim();
	if (!question) return { status: 400, message: 'Escreva uma pergunta.' };
	if (question.length > MAX_QUESTION_CHARS) {
		return {
			status: 400,
			message: `Pergunta longa demais (máximo ${MAX_QUESTION_CHARS} caracteres).`
		};
	}
	// Each question costs one or two LLM calls; the budget is shared with
	// every other LLM entry point for this user.
	const allowed = await checkPersistentRateLimit(
		supabaseAdmin,
		userId,
		LLM_RATE_LIMIT
	);
	if (!allowed) return { status: 429, message: LLM_RATE_LIMIT_MESSAGE };
	return { question };
}

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	ask: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});
		}

		const formData = await request.formData();
		const admitted = await admitQuestion(user.id, formData);
		if ('message' in admitted) {
			return fail(admitted.status, {
				success: false,
				message: admitted.message
			});
		}
		const { question } = admitted;

		const turns = [
			...readHistory(formData.get('history')?.toString()),
			{ role: 'user' as const, content: question }
		];

		const context = await buildContext(supabase, householdId);

		// Candidates the model may choose from. A first pass gives it whatever
		// the question already names; if it asks for a different term, one more
		// lookup runs and the model answers again with the new list.
		let candidates: FundCandidate[] = await searchFunds(question);
		let answer;
		try {
			answer = await askAssistant(turns, context, candidates);
			if (answer.search && !answer.proposal) {
				candidates = await searchFunds(answer.search);
				if (candidates.length > 0) {
					answer = await askAssistant(turns, context, candidates);
				}
			}
		} catch (error) {
			console.error('[investments/assistant] llm call failed', error);
			return fail(500, {
				success: false,
				message: 'Falha ao consultar o assistente. Tente de novo em instantes.'
			});
		}

		return {
			success: true,
			reply: answer.reply,
			proposal: answer.proposal,
			history: [...turns, { role: 'assistant' as const, content: answer.reply }]
		};
	}
};
