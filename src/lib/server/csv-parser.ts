import Papa from 'papaparse';

export type CsvSourceType = 'credit_card' | 'bank_account';

export interface CsvColumnMapping {
	dateColumn: string;
	descriptionColumn: string;
	amountColumn: string;
	identifierColumn?: string;
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
	external_id?: string;
	installment_number?: number;
	installment_total?: number;
	installment_group_key?: string;
}

const DATE_CANDIDATES = ['date', 'data', 'data lançamento', 'data lancamento', 'dt', 'fecha'];
const DESCRIPTION_CANDIDATES = ['title', 'description', 'descrição', 'descricao', 'historico', 'histórico', 'lançamento', 'lancamento', 'estabelecimento', 'memo'];
const AMOUNT_CANDIDATES = ['amount', 'valor', 'valor r$', 'valor (r$)', 'value', 'montante', 'quantia'];
const IDENTIFIER_CANDIDATES = ['identificador', 'id', 'identifier', 'transaction id', 'id transação', 'id transacao'];

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
	const identifierColumn = pickColumn(headers, IDENTIFIER_CANDIDATES) ?? undefined;
	return { dateColumn, descriptionColumn, amountColumn, identifierColumn, currency: 'BRL' };
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
		const rawIdentifier = mapping.identifierColumn ? record[mapping.identifierColumn]?.trim() : undefined;

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

		const clean = cleanDescription(rawDescription);
		const installment = parseInstallment(rawDescription);

		rows.push({
			date,
			description: rawDescription,
			amount,
			currency: mapping.currency ?? 'BRL',
			clean_description: clean,
			external_id: rawIdentifier || undefined,
			installment_number: installment?.number,
			installment_total: installment?.total,
			installment_group_key: installment
				? installmentGroupKey(clean, amount, installment.total)
				: undefined
		});
	}

	return removeNeutralizedStatementPairs(rows);
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

export function cleanDescription(desc: string): string {
	const compact = desc
		.replace(/\s+/g, ' ')
		.replace(/^IOF de /i, '')
		.replace(/^IOF de volta de /i, '')
		.trim();

	const pixMatch = compact.match(/^Transferência (enviada|recebida|Recebida) pelo Pix - ([^-]+?)(?: - |$)/i);
	if (pixMatch) {
		const direction = normalizeToken(pixMatch[1]).startsWith('RECEBIDA') ? 'PIX RECEBIDO' : 'PIX ENVIADO';
		return `${direction} - ${normalizePartyName(pixMatch[2])}`;
	}

	const transferMatch = compact.match(/^Transferência (Recebida|Enviada) - ([^-]+?)(?: - |$)/i);
	if (transferMatch) {
		const direction = normalizeToken(transferMatch[1]).startsWith('RECEBIDA') ? 'TRANSFERENCIA RECEBIDA' : 'TRANSFERENCIA ENVIADA';
		return `${direction} - ${normalizePartyName(transferMatch[2])}`;
	}

	const boletoMatch = compact.match(/^Pagamento de boleto efetuado - (.+)$/i);
	if (boletoMatch) return `BOLETO - ${normalizePartyName(boletoMatch[1])}`;

	const debitMatch = compact.match(/^Compra no débito - (.+)$/i);
	if (debitMatch) return `DEBITO - ${normalizePartyName(debitMatch[1])}`;

	return normalizePartyName(compact);
}

export function buildDuplicateKey(row: ParsedRow): string {
	return buildImportDedupKey(row);
}

export function buildImportDedupKey(row: Pick<ParsedRow, 'date' | 'clean_description' | 'amount' | 'currency'>): string {
	const cleanDescription = row.clean_description.trim().replace(/\s+/g, ' ').toUpperCase();
	return `${row.date}|${cleanDescription}|${row.amount.toFixed(2)}|${row.currency || 'BRL'}`;
}

// Credit card statements mark installments as "k/n" (installment k of n),
// often prefixed with "Parcela"/"Parc". We only trust a bare trailing "k/n"
// when it is at the very end of the description; a "Parcela"/"de" keyword may
// appear anywhere. Totals are capped at 72 and k must be within 1..n so that
// dates ("12/06") and fractions are not mistaken for installments.
const INSTALLMENT_PATTERNS: RegExp[] = [
	/\bparc(?:ela)?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i,
	/(?:^|[\s-])(\d{1,2})\s*\/\s*(\d{1,2})\s*$/,
	/(?:^|[\s-])(\d{1,2})\s+de\s+(\d{1,2})\s*$/i
];

export function parseInstallment(description: string): { number: number; total: number } | null {
	const text = description.normalize('NFD').replace(/\p{Diacritic}/gu, '');
	for (const re of INSTALLMENT_PATTERNS) {
		const match = text.match(re);
		if (!match) continue;
		const number = Number(match[1]);
		const total = Number(match[2]);
		if (!Number.isInteger(number) || !Number.isInteger(total)) continue;
		if (total < 2 || total > 72) continue;
		if (number < 1 || number > total) continue;
		return { number, total };
	}
	return null;
}

// Ties installments of the same purchase together across statements. The clean
// description has the "k/n" marker stripped so every month lands on the same
// key; the per-installment amount and total keep unrelated purchases apart.
export function installmentGroupKey(cleanDescription: string, amount: number, total: number): string {
	const base = cleanDescription
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toUpperCase()
		.replace(/\bPARC(?:ELA)?\.?\s*\d{1,2}\s*(?:\/|DE)\s*\d{1,2}\b/g, '')
		.replace(/(?:^|[\s-])\d{1,2}\s*\/\s*\d{1,2}\s*$/g, '')
		.replace(/(?:^|[\s-])\d{1,2}\s+DE\s+\d{1,2}\s*$/g, '')
		.replace(/\s*-\s*$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return `${base}|${total}|${Math.abs(amount).toFixed(2)}`;
}

function normalizePartyName(value: string): string {
	return normalizeToken(value)
		.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '')
		.replace(/[•*.]{2,}\.?\d{3}\.\d{3}-[•*\d]{2}/g, '')
		.replace(/\b(AG[EÊ]NCIA|AG)\s*:?\s*[\d-]+\b/g, '')
		.replace(/\bCONTA\s*:?\s*[\d.-]+\b/g, '')
		.replace(/\b[A-Z ]+\s+S\.A\.\s*\(\d{4}\)/g, '')
		.replace(/\b[A-Z ]+\s+IP\s*(LTDA\.)?\s*\(\d{4}\)/g, '')
		.replace(/\bBCO\s+[A-Z ]+\s+S\.A\.\s*\(\d{4}\)/g, '')
		.replace(/\bNU PAGAMENTOS\s+-?\s*IP\s*\(\d{4}\)/g, '')
		.replace(/\s+-\s*$/g, '')
		.replace(/(?:\s+-\s*){2,}/g, ' - ')
		.replace(/\s+/g, ' ')
		.trim();
}

function normalizeToken(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
}

function removeNeutralizedStatementPairs(rows: ParsedRow[]): ParsedRow[] {
	const indexesToSkip = new Set<number>();
	const groups = new Map<string, Array<{ row: ParsedRow; index: number }>>();

	rows.forEach((row, index) => {
		if (!row.external_id || row.amount === 0) return;
		const key = [
			row.external_id,
			row.date,
			row.clean_description,
			Math.abs(row.amount).toFixed(2),
			row.currency || 'BRL'
		].join('|');
		const group = groups.get(key) ?? [];
		group.push({ row, index });
		groups.set(key, group);
	});

	for (const group of groups.values()) {
		const total = group.reduce((sum, item) => sum + item.row.amount, 0);
		const hasPositive = group.some((item) => item.row.amount > 0);
		const hasNegative = group.some((item) => item.row.amount < 0);
		if (hasPositive && hasNegative && Math.abs(total) < 0.005) {
			for (const item of group) indexesToSkip.add(item.index);
		}
	}

	return rows.filter((_, index) => !indexesToSkip.has(index));
}
