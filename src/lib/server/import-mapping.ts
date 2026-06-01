import Papa from 'papaparse';
import { z } from 'zod';
import { callLlm } from '$lib/server/llm';
import { detectMapping, parseCsvBuffer, type CsvColumnMapping, type CsvSourceType, type ParsedRow } from './csv-parser';

const MIN_LLM_MAPPING_CONFIDENCE = 0.6;

const llmMappingSchema = z.object({
	dateColumn: z.string().min(1),
	descriptionColumn: z.string().min(1),
	amountColumn: z.string().min(1),
	identifierColumn: z.string().min(1).optional(),
	currency: z.string().min(3).max(3).optional().default('BRL'),
	sourceType: z.enum(['credit_card', 'bank_account']).optional(),
	confidence: z.number().min(0).max(1),
	notes: z.string().optional()
});

export interface ResolvedImportMapping {
	mapping: CsvColumnMapping;
	rows: ParsedRow[];
	sourceType: CsvSourceType;
	mappingSource: 'deterministic' | 'llm';
	confidence: number;
	notes?: string;
}

export async function resolveImportMapping(
	buffer: Buffer,
	selectedSourceType: CsvSourceType
): Promise<ResolvedImportMapping> {
	const deterministic = detectMapping(buffer) ?? {
		dateColumn: 'date',
		descriptionColumn: 'title',
		amountColumn: 'amount',
		currency: 'BRL'
	};
	const deterministicRows = parseCsvBuffer(buffer, deterministic, { sourceType: selectedSourceType });
	if (deterministicRows.length > 0) {
		return {
			mapping: deterministic,
			rows: deterministicRows,
			sourceType: selectedSourceType,
			mappingSource: 'deterministic',
			confidence: 1
		};
	}

	const llm = await inferMappingWithLlm(buffer, selectedSourceType);
	if (!llm || llm.confidence < MIN_LLM_MAPPING_CONFIDENCE) {
		return {
			mapping: deterministic,
			rows: deterministicRows,
			sourceType: selectedSourceType,
			mappingSource: 'deterministic',
			confidence: 0,
			notes: llm?.notes
		};
	}

	const sourceType = llm.sourceType ?? selectedSourceType;
	const rows = parseCsvBuffer(buffer, llm, { sourceType });
	return {
		mapping: llm,
		rows,
		sourceType,
		mappingSource: 'llm',
		confidence: llm.confidence,
		notes: llm.notes
	};
}

async function inferMappingWithLlm(
	buffer: Buffer,
	selectedSourceType: CsvSourceType
): Promise<(CsvColumnMapping & { sourceType?: CsvSourceType; confidence: number; notes?: string }) | null> {
	const csvString = buffer.toString('utf-8');
	const preview = Papa.parse<Record<string, string>>(csvString, {
		header: true,
		skipEmptyLines: true,
		preview: 8,
		dynamicTyping: false
	});
	const headers = preview.meta.fields ?? [];
	if (headers.length === 0) return null;

	const sampleRows = preview.data.map((row) => {
		const out: Record<string, string> = {};
		for (const header of headers) {
			out[header] = String(row[header] ?? '').slice(0, 120);
		}
		return out;
	});

	const systemPrompt = `You map CSV statement columns for a Brazilian personal finance app. Respond with JSON only.

Rules:
- Return exact CSV header names, preserving spelling and accents.
- dateColumn must identify the purchase/transaction date.
- descriptionColumn must identify merchant, establishment, memo, history, or transaction description.
- amountColumn must identify the monetary amount.
- identifierColumn is optional and should identify a stable row/transaction id when present.
- sourceType is "credit_card" when card purchases are listed as positive charges; otherwise "bank_account".
- Use BRL unless the file clearly says otherwise.
- Set confidence below 0.6 if required columns are ambiguous.`;

	const userPrompt = `The user selected sourceType="${selectedSourceType}". Infer the CSV mapping.

Headers:
${JSON.stringify(headers)}

Sample rows:
${JSON.stringify(sampleRows, null, 2)}

Return JSON in this exact shape:
{
  "dateColumn": "exact header",
  "descriptionColumn": "exact header",
  "amountColumn": "exact header",
  "identifierColumn": "exact header if present",
  "currency": "BRL",
  "sourceType": "credit_card",
  "confidence": 0.0,
  "notes": "short optional note"
}`;

	try {
		const response = await callLlm({
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			temperature: 0,
			max_tokens: 700,
			json_mode: true
		});
		const raw = response.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(raw.replace(/```json\s*|\s*```/g, '').trim());
		const validated = llmMappingSchema.safeParse(parsed);
		if (!validated.success) return null;

		const mapping = validated.data;
		if (
			!headers.includes(mapping.dateColumn) ||
			!headers.includes(mapping.descriptionColumn) ||
			!headers.includes(mapping.amountColumn) ||
			(mapping.identifierColumn && !headers.includes(mapping.identifierColumn))
		) {
			return null;
		}

		return mapping;
	} catch (error) {
		console.error('[imports] LLM mapping failed', error);
		return null;
	}
}
