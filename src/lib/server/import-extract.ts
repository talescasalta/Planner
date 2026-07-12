import { z } from 'zod';
import { callLlm, type LlmContentPart } from '$lib/server/llm';
import {
	cleanDescription,
	installmentGroupKey,
	parseInstallment,
	type CsvSourceType,
	type ParsedRow
} from './csv-parser';

const extractionSchema = z.object({
	transactions: z
		.array(
			z.object({
				date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				description: z.string().min(1),
				amount: z.number()
			})
		)
		.default([]),
	confidence: z.number().min(0).max(1).default(0),
	notes: z.string().optional()
});

export interface ExtractionResult {
	rows: ParsedRow[];
	confidence: number;
	notes?: string;
}

const IMAGE_SIGNATURES: Array<{ mimeType: string; bytes: number[] }> = [
	{
		mimeType: 'image/png',
		bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
	},
	{ mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
	{ mimeType: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] }
];

// The browser-provided MIME type is not always reliable for pasted or renamed
// files. OpenRouter validates the bytes behind a data URL, so use the detected
// type whenever possible rather than sending a misleading MIME header.
export function detectImageMimeType(
	buffer: Buffer
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
	for (const signature of IMAGE_SIGNATURES) {
		if (signature.bytes.every((byte, index) => buffer[index] === byte)) {
			if (signature.mimeType === 'image/webp') {
				if (buffer.subarray(8, 12).toString('ascii') !== 'WEBP') continue;
			}
			return signature.mimeType as 'image/png' | 'image/jpeg' | 'image/webp';
		}
	}
	return null;
}

const SOURCE_TYPE_HINTS: Record<CsvSourceType, string> = {
	credit_card: 'fatura de cartão de crédito',
	bank_account: 'extrato de conta corrente',
	vale_alimentacao:
		'extrato de vale alimentação (benefício como Alelo, VR, Sodexo, Caju, Flash)',
	vale_refeicao:
		'extrato de vale refeição (benefício como Alelo, VR, Sodexo, Caju, Flash)'
};

function buildSystemPrompt(
	sourceType: CsvSourceType,
	referenceMonth: string
): string {
	return `You extract financial transactions from Brazilian statements (screenshots or pasted text) for a personal finance app. The user says this is a ${SOURCE_TYPE_HINTS[sourceType]}. Respond with JSON only.

Rules:
- Extract every transaction visible, in the order shown.
- date: ISO format YYYY-MM-DD. If the year is missing, infer it from the reference month ${referenceMonth} (statements may span the previous month).
- description: the merchant/establishment or transaction description, exactly as shown, including installment markers like "2/5" when present.
- amount: number in reais. Expenses/purchases/debits MUST be negative; credits, refunds, recargas and deposits MUST be positive, regardless of how the statement displays signs.
- Skip rows that are only bill payments of the statement itself ("Pagamento recebido", "Pagamento de fatura"), totals, saldo lines, headers or ads.
- confidence: 0 to 1, below 0.6 if the content is not a statement or is unreadable.
- notes: short optional note in Portuguese about anything ambiguous.

Return JSON in this exact shape:
{
  "transactions": [{ "date": "YYYY-MM-DD", "description": "...", "amount": -12.34 }],
  "confidence": 0.0,
  "notes": "optional"
}`;
}

function toParsedRows(
	transactions: Array<{ date: string; description: string; amount: number }>
): ParsedRow[] {
	const rows: ParsedRow[] = [];
	for (const tx of transactions) {
		const description = tx.description.trim();
		if (!description || !Number.isFinite(tx.amount) || tx.amount === 0)
			continue;
		const clean = cleanDescription(description);
		const installment = parseInstallment(description);
		rows.push({
			date: tx.date,
			description,
			amount: tx.amount,
			currency: 'BRL',
			clean_description: clean,
			installment_number: installment?.number,
			installment_total: installment?.total,
			installment_group_key: installment
				? installmentGroupKey(clean, tx.amount, installment.total)
				: undefined
		});
	}
	return rows;
}

async function runExtraction(
	userContent: string | LlmContentPart[],
	sourceType: CsvSourceType,
	referenceMonth: string
): Promise<ExtractionResult> {
	try {
		const response = await callLlm({
			messages: [
				{
					role: 'system',
					content: buildSystemPrompt(sourceType, referenceMonth)
				},
				{ role: 'user', content: userContent }
			],
			temperature: 0,
			max_tokens: 4000,
			json_mode: true
		});
		const raw = response.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(raw.replace(/```json\s*|\s*```/g, '').trim());
		const validated = extractionSchema.safeParse(parsed);
		if (!validated.success) {
			return {
				rows: [],
				confidence: 0,
				notes: 'A IA não retornou transações em formato válido.'
			};
		}
		return {
			rows: toParsedRows(validated.data.transactions),
			confidence: validated.data.confidence,
			notes: validated.data.notes
		};
	} catch (error) {
		console.error('[imports] extraction failed', {
			model: process.env.LLM_MODEL ?? 'default',
			error: String(error)
		});
		return {
			rows: [],
			confidence: 0,
			notes: 'Falha ao interpretar o conteúdo com IA.'
		};
	}
}

export async function extractRowsFromImage(
	buffer: Buffer,
	mimeType: string,
	sourceType: CsvSourceType,
	referenceMonth: string
): Promise<ExtractionResult> {
	const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
	return runExtraction(
		[
			{
				type: 'text',
				text: 'Extraia as transações desta imagem de fatura/extrato.'
			},
			{ type: 'image_url', image_url: { url: dataUrl } }
		],
		sourceType,
		referenceMonth
	);
}

export async function extractRowsFromText(
	text: string,
	sourceType: CsvSourceType,
	referenceMonth: string
): Promise<ExtractionResult> {
	return runExtraction(
		`Extraia as transações deste conteúdo colado de fatura/extrato:\n\n${text.slice(0, 20000)}`,
		sourceType,
		referenceMonth
	);
}
