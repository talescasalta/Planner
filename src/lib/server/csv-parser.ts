import Papa from 'papaparse';

export type CsvSourceType = 'credit_card' | 'bank_account';

export interface CsvColumnMapping {
	dateColumn: string;
	descriptionColumn: string;
	amountColumn: string;
	currency?: string;
}

export interface ParseOptions {
	sourceType?: CsvSourceType;
}

export interface ParsedRow {
	date: string;
	description: string;
	amount: number;
	currency: string;
	clean_description: string;
}

const DATE_CANDIDATES = ['date', 'data', 'data lançamento', 'data lancamento', 'dt', 'fecha'];
const DESCRIPTION_CANDIDATES = ['title', 'description', 'descrição', 'descricao', 'historico', 'histórico', 'lançamento', 'lancamento', 'estabelecimento', 'memo'];
const AMOUNT_CANDIDATES = ['amount', 'valor', 'valor r$', 'valor (r$)', 'value', 'montante', 'quantia'];

function pickColumn(headers: string[], candidates: string[]): string | null {
	const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
	for (const c of candidates) {
		const idx = lowerHeaders.indexOf(c);
		if (idx >= 0) return headers[idx];
	}
	return null;
}

export function detectMapping(buffer: Buffer): CsvColumnMapping | null {
	const csvString = buffer.toString('utf-8');
	const result = Papa.parse<Record<string, string>>(csvString, {
		header: true,
		skipEmptyLines: true,
		preview: 1
	});
	const headers = result.meta.fields ?? [];
	const dateColumn = pickColumn(headers, DATE_CANDIDATES);
	const descriptionColumn = pickColumn(headers, DESCRIPTION_CANDIDATES);
	const amountColumn = pickColumn(headers, AMOUNT_CANDIDATES);
	if (!dateColumn || !descriptionColumn || !amountColumn) return null;
	return { dateColumn, descriptionColumn, amountColumn, currency: 'BRL' };
}

export function parseCsvBuffer(
	buffer: Buffer,
	mapping: CsvColumnMapping,
	options: ParseOptions = {}
): ParsedRow[] {
	const csvString = buffer.toString('utf-8');
	const parseResult = Papa.parse<Record<string, string>>(csvString, {
		header: true,
		skipEmptyLines: true,
		dynamicTyping: false
	});

	const sourceType: CsvSourceType = options.sourceType ?? 'bank_account';

	const rows: ParsedRow[] = [];
	for (const record of parseResult.data) {
		const rawDate = record[mapping.dateColumn]?.trim();
		const rawDescription = record[mapping.descriptionColumn]?.trim();
		const rawAmount = record[mapping.amountColumn]?.trim();

		if (!rawDate || !rawDescription || rawAmount === undefined) continue;

		const parsedAmount = parseAmount(rawAmount);
		if (Number.isNaN(parsedAmount)) continue;

		// On credit card statements the bill payment shows up as a negative
		// entry (a credit to the card balance) and the description usually
		// mentions "pagamento". Skip it — it's just reconciliation, not a
		// transaction. We require both signals so a legitimate refund
		// ("estorno de ...", also negative) isn't dropped by mistake.
		if (sourceType === 'credit_card' && parsedAmount < 0 && isCreditCardPayment(rawDescription)) {
			continue;
		}

		// Credit card statements typically list charges as positive numbers.
		// Flip the sign so charges become negative (expenses) and payments to
		// the card become positive (credits), matching the bank-account
		// convention used everywhere else in the app.
		const amount = sourceType === 'credit_card' ? -parsedAmount : parsedAmount;

		const date = normalizeDate(rawDate);
		if (!date) continue;

		rows.push({
			date,
			description: rawDescription,
			amount,
			currency: mapping.currency ?? 'BRL',
			clean_description: cleanDescription(rawDescription)
		});
	}

	return rows;
}

function normalizeDate(raw: string): string | null {
	const trimmed = raw.trim();
	// Try yyyy-mm-dd first
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
	// Try dd/mm/yyyy or dd-mm-yyyy
	const parts = trimmed.split(/[/-]/);
	if (parts.length === 3) {
		const [d, m, y] = parts;
		if (y.length !== 4) return null;
		return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
	}
	return null;
}

export function parseAmount(raw: string): number {
	const value = raw
		.trim()
		.replace(/\s/g, '')
		.replace(/^R\$/i, '')
		.replace(/[^\d,.-]/g, '');
	if (!value) return Number.NaN;

	const lastComma = value.lastIndexOf(',');
	const lastDot = value.lastIndexOf('.');
	if (lastComma >= 0 && lastDot >= 0) {
		const decimalSeparator = lastComma > lastDot ? ',' : '.';
		const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
		return Number(value.replaceAll(thousandsSeparator, '').replace(decimalSeparator, '.'));
	}
	if (lastComma >= 0) {
		return Number(value.replaceAll('.', '').replace(',', '.'));
	}
	return Number(value.replaceAll(',', ''));
}

function isCreditCardPayment(description: string): boolean {
	return /\bpag(amento|to)\b/i.test(description);
}

function cleanDescription(desc: string): string {
	return desc
		.replace(/\s+/g, ' ')
		.replace(/^IOF de /i, '')
		.replace(/^IOF de volta de /i, '')
		.trim()
		.toUpperCase();
}

export function buildDuplicateKey(row: ParsedRow): string {
	return buildImportDedupKey(row);
}

export function buildImportDedupKey(row: Pick<ParsedRow, 'date' | 'clean_description' | 'amount' | 'currency'>): string {
	const cleanDescription = row.clean_description.trim().replace(/\s+/g, ' ').toUpperCase();
	return `${row.date}|${cleanDescription}|${row.amount.toFixed(2)}|${row.currency || 'BRL'}`;
}
