import Papa from 'papaparse';

export interface CsvColumnMapping {
	dateColumn: string;
	descriptionColumn: string;
	amountColumn: string;
	currency?: string;
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
const AMOUNT_CANDIDATES = ['amount', 'valor', 'value', 'montante', 'quantia'];

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

export function parseCsvBuffer(buffer: Buffer, mapping: CsvColumnMapping): ParsedRow[] {
	const csvString = buffer.toString('utf-8');
	const parseResult = Papa.parse<Record<string, string>>(csvString, {
		header: true,
		skipEmptyLines: true,
		dynamicTyping: false
	});

	const rows: ParsedRow[] = [];
	for (const record of parseResult.data) {
		const rawDate = record[mapping.dateColumn]?.trim();
		const rawDescription = record[mapping.descriptionColumn]?.trim();
		const rawAmount = record[mapping.amountColumn]?.trim();

		if (!rawDate || !rawDescription || rawAmount === undefined) continue;

		const amount = parseFloat(rawAmount.replace(',', '.'));
		if (Number.isNaN(amount)) continue;

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
	// Try yyyy-mm-dd first
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
	// Try dd/mm/yyyy
	const parts = raw.split('/');
	if (parts.length === 3) {
		const [d, m, y] = parts;
		return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
	}
	return null;
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
	return `${row.date}|${row.clean_description}|${row.amount}`;
}
