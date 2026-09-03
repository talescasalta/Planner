import { z } from 'zod';
import { callLlm } from '$lib/server/llm';
import { onlyDigits } from './investment-funds';
import { MAX_PROMPT_TEXT_CHARS, clampText } from './request-guards';

// Reads a fund position from a broker screenshot.
//
// The prompt is written against the screens this actually sees. Two brokers,
// two vocabularies: Nubank states "Valor aplicado" outright, XP gives only
// "Rendimento" and the cost has to come from subtracting it. Titles are cut
// mid-word, and a "Cód." shown next to the fund is the broker's own numbering,
// never the CVM subclass — reading it as one would track a different quota.
//
// The model is never asked for a CNPJ it cannot see: an invented one values
// today's balance correctly and then silently follows another fund.

const fundSchema = z.object({
	funds: z.array(
		z.object({
			name: z.string().min(1),
			cnpj: z.string().optional(),
			balance: z.number(),
			applied: z.number().nullable().optional(),
			gain: z.number().nullable().optional(),
			balance_date: z.string().nullable().optional(),
			kind: z.enum(['fundo', 'previdencia']).optional()
		})
	),
	confidence: z.number().min(0).max(1),
	notes: z.string().optional()
});

export interface ExtractedFund {
	name: string;
	cnpj: string | null;
	balance: number;
	applied: number | null;
	balanceDate: string | null;
	kind: 'fundo' | 'previdencia';
}

export interface FundExtraction {
	funds: ExtractedFund[];
	confidence: number;
	notes?: string;
}

function prompt(today: string): string {
	return `You read Brazilian broker screens showing investment fund or pension (previdência) positions, for a personal finance app. Respond with JSON only.

Rules:
- Extract every fund visible. A screen may show one fund in detail or several as cards.
- name: the fund name exactly as displayed, even if the app truncated it with "…". Never complete or guess the missing part.
- cnpj: only if a CNPJ is actually visible on the screen. Omit it otherwise — never infer or recall one.
- balance: the gross current value, in reais. Labels: "Saldo", "Saldo bruto", "Total bruto", "Valor bruto". If both gross and net ("Saldo líquido") appear, take the GROSS one.
- applied: the amount contributed, when the screen states it ("Valor aplicado", "Total investido"). Null if absent.
- gain: the accumulated profit, when stated ("Rendimento", "Valorização", "Rentabilidade" in reais). Null if absent. Prefer the value in reais, never the percentage.
- If the screen shows a gain scoped to a period ("Rendimento 12M", "nos últimos 12 meses"), that is NOT the accumulated gain: report it as null and say so in notes.
- balance_date: ISO YYYY-MM-DD when the screen dates the balance. "Atualizado hoje" means ${today}; a weekday name means the most recent such day before ${today}. Null if absent.
- kind: "previdencia" when the screen mentions previdência, PGBL or VGBL; "fundo" otherwise.
- Ignore any "Cód." or internal code shown beside the fund: it is the broker's numbering, not a CVM identifier, and must not be reported as a CNPJ.
- confidence: 0 to 1. Below 0.6 if the image is not a fund position screen or the numbers are unreadable.
- notes: short note in Portuguese about anything ambiguous (truncated names, period-scoped gains, missing values).

Return JSON in this exact shape:
{
  "funds": [{ "name": "...", "cnpj": "12345678000199", "balance": 18302.57, "applied": 9140.34, "gain": 9162.23, "balance_date": "2026-08-31", "kind": "fundo" }],
  "confidence": 0.0,
  "notes": "optional"
}`;
}

function toExtracted(
	raw: z.infer<typeof fundSchema>['funds'][number]
): ExtractedFund | null {
	if (!Number.isFinite(raw.balance) || raw.balance <= 0) return null;
	const applied = appliedFrom(raw.balance, raw.applied, raw.gain);
	const cnpj = raw.cnpj ? onlyDigits(raw.cnpj) : '';
	return {
		name: raw.name.trim(),
		cnpj: cnpj.length === 14 ? cnpj : null,
		balance: raw.balance,
		applied,
		balanceDate: isoDateOrNull(raw.balance_date),
		kind: raw.kind === 'previdencia' ? 'previdencia' : 'fundo'
	};
}

// The cost basis is either stated outright, as Nubank does, or the balance
// minus the accumulated gain, as XP leaves it. A gain the screen scoped to a
// period arrives as null from the prompt, precisely so it is never subtracted.
function appliedFrom(
	balance: number,
	applied: number | null | undefined,
	gain: number | null | undefined
): number | null {
	const stated = usableNumber(applied);
	if (stated !== null) return stated >= 0 ? stated : null;
	const profit = usableNumber(gain);
	if (profit === null) return null;
	const derived = balance - profit;
	return derived >= 0 ? derived : null;
}

function usableNumber(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isoDateOrNull(value: string | null | undefined): string | null {
	return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function parseExtraction(content: string): FundExtraction {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return {
			funds: [],
			confidence: 0,
			notes: 'A resposta do modelo não era JSON.'
		};
	}
	const validated = fundSchema.safeParse(parsed);
	if (!validated.success) {
		return {
			funds: [],
			confidence: 0,
			notes: 'A resposta do modelo veio fora do formato.'
		};
	}
	return {
		funds: validated.data.funds
			.map(toExtracted)
			.filter((fund): fund is ExtractedFund => fund !== null),
		confidence: validated.data.confidence,
		notes: validated.data.notes
	};
}

export async function extractFundsFromImage(
	image: Buffer,
	mimeType: string,
	today: string = new Date().toISOString().slice(0, 10)
): Promise<FundExtraction> {
	const response = await callLlm({
		messages: [
			{ role: 'system', content: prompt(today) },
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Extraia as posições de fundo desta tela.' },
					{
						type: 'image_url',
						image_url: {
							url: `data:${mimeType};base64,${image.toString('base64')}`
						}
					}
				]
			}
		],
		json_mode: true
	});
	return parseExtraction(response.choices[0]?.message?.content ?? '');
}

export async function extractFundsFromText(
	text: string,
	today: string = new Date().toISOString().slice(0, 10)
): Promise<FundExtraction> {
	const response = await callLlm({
		messages: [
			{ role: 'system', content: prompt(today) },
			{ role: 'user', content: clampText(text, MAX_PROMPT_TEXT_CHARS) }
		],
		json_mode: true
	});
	return parseExtraction(response.choices[0]?.message?.content ?? '');
}
