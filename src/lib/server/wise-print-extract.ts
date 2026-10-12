import { z } from 'zod';
import { callLlm } from '$lib/server/llm';
import { isForeignCurrency, type ForeignCurrency } from './fx-rates';

// Reads the Rende+ screen of the Wise app or site.
//
// The screen gives, per currency, the balance in that currency, the gain in
// that currency and the "taxa variável" — plus a grand total converted to
// reais at Wise's own rate. Only the native figures are kept: the reais come
// from PTAX like every other conversion here, and a total in BRL is never
// mistaken for a balance in dollars.

const printSchema = z.object({
	balances: z.array(
		z.object({
			currency: z.string(),
			balance: z.number(),
			gain: z.number().nullable().optional(),
			rate_percent: z.number().nullable().optional()
		})
	),
	rate_date: z.string().nullable().optional(),
	confidence: z.number().min(0).max(1),
	notes: z.string().optional()
});

export interface RendeBalance {
	currency: ForeignCurrency;
	balance: number;
	gain: number | null;
	ratePercent: number | null;
}

export interface RendeExtraction {
	balances: RendeBalance[];
	rateDate: string | null;
	confidence: number;
	notes?: string;
}

const PROMPT = `You read the "Rende+" screen of the Wise app or website (Brazilian Portuguese UI), for a personal finance app. Respond with JSON only.

The screen shows a total in BRL ("Total mantido no Rende+"), a total gain in BRL, and then one line per currency under "Investidos no Rende+", like:
  USD — "27.247,71 USD - Taxa variável de 3.61%" — "+ 102,98 USD"

Rules:
- balances: one entry per currency line. NEVER use the BRL total as a balance.
- currency: the ISO code on that line (USD, EUR, GBP).
- balance: the amount in that currency on that line (27247.71 above). Brazilian number format: "." groups thousands, "," is the decimal separator.
- gain: the signed gain in that currency shown on the right of that line (102.98 above). Null if absent.
- rate_percent: the "Taxa variável" as a number (3.61 above). Null if absent.
- rate_date: ISO YYYY-MM-DD of the date the footnote says the rates are based on ("desempenho de 7 dias em 23 de setembro de 2026" → "2026-09-23"). Null if absent.
- confidence: 0 to 1. Below 0.6 if the image is not this screen or the numbers are unreadable.
- notes: short note in Portuguese about anything ambiguous.

Return JSON in this exact shape:
{ "balances": [{ "currency": "USD", "balance": 27247.71, "gain": 102.98, "rate_percent": 3.61 }], "rate_date": "2026-09-23", "confidence": 0.0, "notes": "optional" }`;

function finiteOrNull(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseRendeExtraction(content: string): RendeExtraction {
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch {
		return {
			balances: [],
			rateDate: null,
			confidence: 0,
			notes: 'A resposta do modelo não era JSON.'
		};
	}
	const validated = printSchema.safeParse(raw);
	if (!validated.success) {
		return {
			balances: [],
			rateDate: null,
			confidence: 0,
			notes: 'A resposta do modelo veio fora do formato.'
		};
	}
	const rateDate = validated.data.rate_date ?? '';
	return {
		balances: validated.data.balances
			.map(readBalance)
			.filter((line): line is RendeBalance => line !== null),
		rateDate: /^\d{4}-\d{2}-\d{2}$/.test(rateDate) ? rateDate : null,
		confidence: validated.data.confidence,
		notes: validated.data.notes
	};
}

// A line in a currency we convert, with a positive balance. A rate outside
// (0, 100) is a misread, not a fund paying it.
function readBalance(
	line: z.infer<typeof printSchema>['balances'][number]
): RendeBalance | null {
	const currency = line.currency.trim().toUpperCase();
	if (!isForeignCurrency(currency)) return null;
	if (!Number.isFinite(line.balance) || line.balance <= 0) return null;
	const rate = finiteOrNull(line.rate_percent);
	return {
		currency,
		balance: line.balance,
		gain: finiteOrNull(line.gain),
		ratePercent: rate !== null && rate > 0 && rate < 100 ? rate : null
	};
}

export async function extractRendeFromImage(
	image: Buffer,
	mimeType: string
): Promise<RendeExtraction> {
	const response = await callLlm({
		messages: [
			{ role: 'system', content: PROMPT },
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Extraia os saldos do Rende+ desta tela.' },
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
	return parseRendeExtraction(response.choices[0]?.message?.content ?? '');
}
