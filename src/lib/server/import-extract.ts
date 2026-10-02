import { z } from 'zod';
import {
	callLlm,
	type LlmContentPart,
	type LlmResponse
} from '$lib/server/llm';
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
				amount: z.number(),
				direction: z.enum(['in', 'out']).optional(),
				direction_cue: z.enum(['sinal', 'cor', 'semantica', 'icone']).optional()
			})
		)
		.default([]),
	opening_balance: z.number().nullable().optional(),
	closing_balance: z.number().nullable().optional(),
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

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

// Statement PDFs are the only format Itaú exports for checking accounts, so we
// detect them by signature (the browser MIME type is unreliable) and turn them
// into text for the regular LLM extraction path.
export function isPdf(buffer: Buffer): boolean {
	return PDF_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

export interface PdfTextResult {
	text: string;
	pages: number;
}

export async function extractTextFromPdf(
	buffer: Buffer
): Promise<PdfTextResult | null> {
	try {
		const { extractText, getDocumentProxy } = await import('unpdf');
		const document = await getDocumentProxy(new Uint8Array(buffer));
		const { totalPages, text } = await extractText(document, {
			mergePages: true
		});
		return { text: text.trim(), pages: totalPages };
	} catch (error) {
		console.error('[imports] pdf text extraction failed', String(error));
		return null;
	}
}

const SOURCE_TYPE_HINTS: Record<CsvSourceType, string> = {
	credit_card: 'fatura de cartão de crédito',
	bank_account: 'extrato de conta corrente',
	vale_alimentacao:
		'extrato de vale alimentação (benefício como Alelo, VR, Sodexo, Caju, Flash)',
	vale_refeicao:
		'extrato de vale refeição (benefício como Alelo, VR, Sodexo, Caju, Flash)'
};

export interface ChunkPart {
	index: number;
	total: number;
}

function buildSystemPrompt(
	sourceType: CsvSourceType,
	referenceMonth: string,
	part?: ChunkPart
): string {
	const partRule =
		part && part.total > 1
			? `
- This is part ${part.index} of ${part.total} of the same statement, split on line boundaries. Extract only the transactions that appear in this part and never invent rows for the others.`
			: '';
	return `You extract financial transactions from Brazilian statements (screenshots or pasted text) for a personal finance app. The user says this is a ${SOURCE_TYPE_HINTS[sourceType]}. Respond with JSON only.

Rules:
- Extract every transaction visible, in the order shown.
- date: ISO format YYYY-MM-DD. If the year is missing, infer it from the reference month ${referenceMonth} (statements may span the previous month).
- description: the merchant/establishment or transaction description, exactly as shown, including installment markers like "2/5" when present.
- direction: "out" when money leaves the account (purchases, debits, Pix/TED/boleto sent, "Pagamento efetuado"); "in" when money enters (deposits, refunds/estornos, Pix/TED received, "recebido", proventos, rendimentos, recargas, salário).
- Brazilian bank apps (Nubank, Inter, etc.) usually show NO minus sign on outgoing amounts. Decide direction using these cues, from most to least reliable: (1) an explicit "+" prefix or green-colored amount means "in"; (2) description semantics (e.g. "recebido", "proventos", "rendimentos", "depósito", "estorno" = in; "pagamento efetuado", "débito", "compra" = out); (3) the row icon (sent vs received Pix arrows point in opposite directions). A plain amount without "+" is usually "out", but check semantics before assuming.
- direction_cue: which cue decided the direction: "sinal" (explicit +/- or DR/CR marker), "cor" (color), "semantica" (wording) or "icone" (icon only).
- amount: number in reais. The sign MUST match direction: negative when "out", positive when "in", regardless of how the statement displays signs.
- Skip rows that are only bill payments of the statement itself ("Pagamento recebido", "Pagamento de fatura"), totals, saldo lines, headers or ads.
- Skip entries that are struck through or marked as cancelled/scheduled ("Agendamento cancelado", "agendado") — money did not move.
- confidence: 0 to 1, below 0.6 if the content is not a statement or is unreadable. Cap it at 0.7 when the direction of any transaction relied only on "icone".
- notes: short optional note in Portuguese about anything ambiguous.
- opening_balance / closing_balance: only when the statement prints running balances. opening_balance is the balance immediately BEFORE the oldest transaction in this content; closing_balance is the balance immediately AFTER the newest one. Itaú statements list newest first with "SALDO DO DIA" lines, so read the balance carefully by date. Use null when balances are not shown; never guess.${partRule}

Return JSON in this exact shape:
{
  "transactions": [{ "date": "YYYY-MM-DD", "description": "...", "amount": -12.34, "direction": "out", "direction_cue": "semantica" }],
  "opening_balance": null,
  "closing_balance": null,
  "confidence": 0.0,
  "notes": "optional"
}`;
}

function toParsedRows(
	transactions: Array<{
		date: string;
		description: string;
		amount: number;
		direction?: 'in' | 'out';
	}>
): ParsedRow[] {
	const rows: ParsedRow[] = [];
	for (const tx of transactions) {
		const description = tx.description.trim();
		if (!description || !Number.isFinite(tx.amount) || tx.amount === 0)
			continue;
		// The declared direction is more reliable than the sign the model put on
		// the amount: statements often omit the minus on outgoing entries.
		const amount =
			tx.direction === 'out'
				? -Math.abs(tx.amount)
				: tx.direction === 'in'
					? Math.abs(tx.amount)
					: tx.amount;
		const clean = cleanDescription(description);
		const installment = parseInstallment(description);
		rows.push({
			date: tx.date,
			description,
			amount,
			currency: 'BRL',
			clean_description: clean,
			installment_number: installment?.number,
			installment_total: installment?.total,
			installment_group_key: installment
				? installmentGroupKey(clean, amount, installment.total)
				: undefined
		});
	}
	return rows;
}

interface ChunkResult extends ExtractionResult {
	openingBalance?: number | null;
	closingBalance?: number | null;
	failed?: boolean;
}

const TRUNCATED_NOTE =
	'A resposta da IA foi cortada; confira se faltam lançamentos.';
const TRUNCATED_UNREADABLE_NOTE =
	'A resposta da IA foi cortada antes do fim. Envie o extrato em períodos menores.';

function joinNotes(
	...parts: Array<string | false | null | undefined>
): string | undefined {
	return parts.filter(Boolean).join(' · ') || undefined;
}

function failedChunk(notes: string): ChunkResult {
	return { rows: [], confidence: 0, notes, failed: true };
}

function parseModelJson(raw: string): unknown {
	return JSON.parse(raw.replace(/```json\s*|\s*```/g, '').trim());
}

// Throws on JSON that cannot be parsed, which runExtraction reports as a
// generic failure; a reply cut off by the token limit is the exception and
// gets its own explanation.
function chunkFromReply(choice: LlmResponse['choices'][number] | undefined) {
	const truncated = choice?.finish_reason === 'length';
	let parsed: unknown;
	try {
		parsed = parseModelJson(choice?.message?.content ?? '{}');
	} catch (error) {
		if (truncated) return failedChunk(TRUNCATED_UNREADABLE_NOTE);
		throw error;
	}
	const validated = extractionSchema.safeParse(parsed);
	if (!validated.success) {
		return failedChunk('A IA não retornou transações em formato válido.');
	}
	const result: ChunkResult = {
		rows: toParsedRows(validated.data.transactions),
		confidence: truncated
			? Math.min(validated.data.confidence, 0.6)
			: validated.data.confidence,
		notes: joinNotes(validated.data.notes, truncated && TRUNCATED_NOTE),
		openingBalance: validated.data.opening_balance,
		closingBalance: validated.data.closing_balance
	};
	return result;
}

async function runExtraction(
	userContent: string | LlmContentPart[],
	sourceType: CsvSourceType,
	referenceMonth: string,
	part?: ChunkPart
): Promise<ChunkResult> {
	try {
		const response = await callLlm({
			messages: [
				{
					role: 'system',
					content: buildSystemPrompt(sourceType, referenceMonth, part)
				},
				{ role: 'user', content: userContent }
			],
			temperature: 0,
			max_tokens: 8000,
			json_mode: true
		});
		return chunkFromReply(response.choices[0]);
	} catch (error) {
		console.error('[imports] extraction failed', {
			model: process.env.LLM_MODEL ?? 'default',
			error: String(error)
		});
		return failedChunk('Falha ao interpretar o conteúdo com IA.');
	}
}

// What the statement says it started and ended with must equal what the
// extracted rows add up to; a gap means the model dropped (or mis-signed) a
// line. Null when the statement printed no balances, so nothing is checked.
export function balanceCheck(
	rows: Array<{ amount: number }>,
	opening: number | null | undefined,
	closing: number | null | undefined
): { difference: number } | null {
	if (opening == null || closing == null) return null;
	const cents = rows.reduce(
		(sum, row) => sum + Math.round(row.amount * 100),
		0
	);
	const difference =
		(Math.round(opening * 100) + cents - Math.round(closing * 100)) / 100;
	return { difference };
}

const BALANCE_TOLERANCE = 0.01;
const BALANCE_MISMATCH_CONFIDENCE_CAP = 0.6;

function formatReais(value: number): string {
	return Math.abs(value).toLocaleString('pt-BR', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	});
}

function dateRange(rows: ParsedRow[]) {
	const dates = rows.map((row) => row.date).sort();
	return { min: dates[0], max: dates[dates.length - 1] };
}

// The oldest chunk by date carries the opening balance and the newest the
// closing one, whatever order the statement lists them in (Itaú is newest
// first).
function statementBalanceNote(rows: ParsedRow[], chunks: ChunkResult[]) {
	const withRows = chunks.filter((chunk) => chunk.rows.length > 0);
	if (withRows.length === 0) return null;
	const oldest = [...withRows].sort((a, b) =>
		dateRange(a.rows).min.localeCompare(dateRange(b.rows).min)
	)[0];
	const newest = [...withRows].sort((a, b) =>
		dateRange(b.rows).max.localeCompare(dateRange(a.rows).max)
	)[0];
	const check = balanceCheck(
		rows,
		oldest.openingBalance,
		newest.closingBalance
	);
	if (!check || Math.abs(check.difference) <= BALANCE_TOLERANCE) return null;
	return `Saldo não fecha: diferença de R$ ${formatReais(check.difference)} — pode faltar lançamento ou haver um valor com sinal errado.`;
}

function mergeChunks(chunks: ChunkResult[]): ExtractionResult {
	const total = chunks.length;
	const rows = chunks.flatMap((chunk) => chunk.rows);
	const succeeded = chunks.filter((chunk) => !chunk.failed);
	const anyFailed = succeeded.length < total;
	let confidence = succeeded.length
		? Math.min(...succeeded.map((chunk) => chunk.confidence))
		: 0;
	const notes: string[] = [];
	chunks.forEach((chunk, index) => {
		if (total > 1 && chunk.failed) {
			notes.push(`Parte ${index + 1} de ${total} não pôde ser lida.`);
		} else if (chunk.notes) {
			notes.push(chunk.notes);
		}
	});
	if (anyFailed && succeeded.length > 0) confidence = Math.min(confidence, 0.6);
	// With a part missing the sums cannot match; reporting that would only
	// repeat the failure already noted.
	if (!anyFailed) {
		const balanceNote = statementBalanceNote(rows, chunks);
		if (balanceNote) {
			notes.push(balanceNote);
			confidence = Math.min(confidence, BALANCE_MISMATCH_CONFIDENCE_CAP);
		}
	}
	return {
		rows,
		confidence,
		notes: notes.length > 0 ? notes.join(' · ') : undefined
	};
}

// Splits on line boundaries so a transaction is never cut in half. A single
// line longer than the limit (pathological input) is the only thing split
// mid-line.
export function chunkStatementText(
	input: string | string[],
	maxChars = 8000
): string[] {
	const text = (Array.isArray(input) ? input.join('\n') : input).trim();
	if (!text) return [];
	const chunks: string[] = [];
	let current = '';
	const flush = () => {
		if (current) chunks.push(current);
		current = '';
	};
	for (const line of text.split('\n')) {
		for (let start = 0; start === 0 || start < line.length; start += maxChars) {
			const piece = line.slice(start, start + maxChars);
			if (current && current.length + 1 + piece.length > maxChars) flush();
			current = current ? `${current}\n${piece}` : piece;
		}
	}
	flush();
	return chunks;
}

export async function extractRowsFromImage(
	buffer: Buffer,
	mimeType: string,
	sourceType: CsvSourceType,
	referenceMonth: string
): Promise<ExtractionResult> {
	const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
	return mergeChunks([
		await runExtraction(
			[
				{
					type: 'text',
					text: 'Extraia as transações desta imagem de fatura/extrato.'
				},
				{ type: 'image_url', image_url: { url: dataUrl } }
			],
			sourceType,
			referenceMonth
		)
	]);
}

// Long statements are read in sequential chunks: one reply can only carry so
// many transactions, and a reply cut off by the token limit used to discard the
// whole import. A failed chunk is reported by number while the rest is kept.
export async function extractRowsFromText(
	text: string,
	sourceType: CsvSourceType,
	referenceMonth: string
): Promise<ExtractionResult> {
	const parts = chunkStatementText(text);
	const chunks = parts.length > 0 ? parts : [''];
	const results: ChunkResult[] = [];
	for (const [index, chunk] of chunks.entries()) {
		const part = { index: index + 1, total: chunks.length };
		const intro =
			chunks.length > 1
				? `Extraia as transações do trecho ${part.index} de ${part.total} deste conteúdo de fatura/extrato:`
				: 'Extraia as transações deste conteúdo colado de fatura/extrato:';
		results.push(
			await runExtraction(
				`${intro}\n\n${chunk}`,
				sourceType,
				referenceMonth,
				part
			)
		);
	}
	return mergeChunks(results);
}
