import ExcelJS from 'exceljs';

// The B3 "Área do Investidor" exports are xlsx with fixed sheet names and
// headers, so parsing is fully deterministic — no LLM fallback needed here.

export type B3FileKind = 'posicao' | 'negociacao' | 'movimentacao';

export interface B3Sheet {
	name: string;
	header: string[];
	// Data rows aligned to the header; cells are string | number | null.
	rows: (string | number | null)[][];
}

const XLSX_MAGIC = Buffer.from('PK\x03\x04', 'binary');

export function isXlsx(buffer: Buffer): boolean {
	return buffer.length > 4 && buffer.subarray(0, 4).equals(XLSX_MAGIC);
}

// B3 fills empty cells with a literal "-" instead of leaving them blank.
function normalizeCell(value: ExcelJS.CellValue): string | number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return value;
	if (value instanceof Date) {
		// Dates come as dd/mm/yyyy strings in these exports; a Date here means
		// Excel coerced one, so re-serialize to the same convention.
		const dd = String(value.getUTCDate()).padStart(2, '0');
		const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
		return `${dd}/${mm}/${value.getUTCFullYear()}`;
	}
	if (typeof value === 'object') {
		// Rich text / formula results.
		if ('result' in value && value.result !== undefined)
			return normalizeCell(value.result as ExcelJS.CellValue);
		if ('richText' in value)
			return value.richText.map((part) => part.text).join('');
		return null;
	}
	const text = String(value).trim();
	if (text === '' || text === '-') return null;
	return text;
}

export async function readB3Workbook(buffer: Buffer): Promise<B3Sheet[]> {
	const workbook = new ExcelJS.Workbook();
	await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
	const sheets: B3Sheet[] = [];
	workbook.eachSheet((worksheet) => {
		const header: string[] = [];
		const headerRow = worksheet.getRow(1);
		headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
			const value = normalizeCell(cell.value);
			header[col - 1] = value === null ? '' : String(value);
		});
		if (header.every((cell) => cell === '')) return;

		const rows: (string | number | null)[][] = [];
		worksheet.eachRow((row, rowNumber) => {
			if (rowNumber === 1) return;
			const cells: (string | number | null)[] = new Array(header.length).fill(
				null
			);
			row.eachCell({ includeEmpty: true }, (cell, col) => {
				if (col <= header.length) cells[col - 1] = normalizeCell(cell.value);
			});
			// B3 emits blank spacer rows (e.g. at the end of the Renda Fixa
			// sheet); a row with no product in the first column carries nothing.
			if (cells[0] === null) return;
			rows.push(cells);
		});
		sheets.push({ name: worksheet.name, header, rows });
	});
	return sheets;
}

// Detection is by header content, not filename, so the user can upload any of
// the three exports without saying which is which.
export function detectB3FileKind(sheets: B3Sheet[]): B3FileKind | null {
	for (const sheet of sheets) {
		const header = sheet.header.map((cell) => cell.toLowerCase());
		if (header.includes('data do negócio')) return 'negociacao';
		if (header.includes('entrada/saída') && header.includes('movimentação'))
			return 'movimentacao';
		if (
			header.includes('valor atualizado') ||
			header.includes('valor atualizado mtm')
		)
			return 'posicao';
	}
	return null;
}

export function asString(value: string | number | null): string | null {
	if (value === null) return null;
	return String(value).trim() || null;
}

export function asNumber(value: string | number | null): number | null {
	if (value === null) return null;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	// Defensive: numbers should already be numeric in xlsx, but tolerate
	// pt-BR formatted strings ("1.234,56").
	const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
	return Number.isFinite(parsed) ? parsed : null;
}

// dd/mm/yyyy → yyyy-mm-dd (ISO date for Postgres).
export function parseB3Date(value: string | number | null): string | null {
	const text = asString(value);
	if (!text) return null;
	const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (!match) return null;
	const [, dd, mm, yyyy] = match;
	const day = Number(dd);
	const month = Number(mm);
	if (day < 1 || day > 31 || month < 1 || month > 12) return null;
	return `${yyyy}-${mm}-${dd}`;
}
