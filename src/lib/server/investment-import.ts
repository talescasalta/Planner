import {
	asNumber,
	asString,
	detectB3FileKind,
	isXlsx,
	parseB3Date,
	readB3Workbook,
	type B3FileKind,
	type B3Sheet
} from './investment-xlsx';
import {
	normalizeProduct,
	resolveAssetSpec,
	type AssetClass,
	type AssetSpec,
	type ResolveContext
} from './investment-assets';

export interface ParsedPosition {
	spec: AssetSpec;
	rawProduct: string;
	institution: string | null;
	quantity: number;
	closePrice: number | null;
	grossValue: number | null;
	netValue: number;
	appliedValue: number | null;
}

export interface ParsedEvent {
	spec: AssetSpec;
	rawProduct: string;
	eventDate: string;
	eventType: string;
	direction: 'credit' | 'debit';
	quantity: number | null;
	unitPrice: number | null;
	totalValue: number | null;
	institution: string | null;
	source: 'b3_movimentacao' | 'b3_negociacao';
	dedupKey: string;
}

export interface ParsedB3File {
	kind: B3FileKind;
	positions: ParsedPosition[];
	events: ParsedEvent[];
	warnings: string[];
}

// The user picks the date on upload when the filename does not carry one.
export function snapshotDateFromFilename(filename: string): string | null {
	const match = filename.match(/posicao-(\d{4})-(\d{2})-(\d{2})/);
	return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function columnIndex(sheet: B3Sheet, ...names: string[]): number {
	const header = sheet.header.map((cell) => cell.toLowerCase());
	for (const name of names) {
		const index = header.indexOf(name.toLowerCase());
		if (index !== -1) return index;
	}
	return -1;
}

function cell(
	row: (string | number | null)[],
	index: number
): string | number | null {
	return index === -1 ? null : (row[index] ?? null);
}

// Sheet name → authoritative class for posição rows. "Fundo de Investimento"
// holds listed fund quotas: suffix-11 tickers there are FIIs in practice;
// anything else stays a generic fundo.
function sheetClass(
	name: string,
	ticker: string | null
): AssetClass | undefined {
	const lowered = name.toLowerCase();
	if (lowered === 'etf') return 'etf';
	if (lowered.startsWith('fundo'))
		return ticker?.endsWith('11') ? 'fii' : 'fundo';
	if (
		lowered.startsWith('ação') ||
		lowered.startsWith('ações') ||
		lowered === 'bdr'
	)
		return 'acao';
	if (lowered === 'tesouro direto') return 'tesouro';
	// Renda Fixa rows are classified by their product prefix (CDB/LCA/...).
	return undefined;
}

function parsePosicaoSheet(
	sheet: B3Sheet,
	warnings: string[]
): ParsedPosition[] {
	const produto = columnIndex(sheet, 'produto');
	const instituicao = columnIndex(sheet, 'instituição');
	const quantidade = columnIndex(sheet, 'quantidade');
	const tipo = columnIndex(sheet, 'tipo');
	const codigo = columnIndex(sheet, 'código');
	const emissor = columnIndex(sheet, 'emissor');
	const closePrice = columnIndex(sheet, 'preço de fechamento');
	const applied = columnIndex(sheet, 'valor aplicado');
	const gross = columnIndex(sheet, 'valor bruto');
	// Renda Fixa values three ways; first available wins (their rows fill
	// exactly one of MTM/CURVA/FECHAMENTO).
	const netCandidates = [
		columnIndex(sheet, 'valor atualizado'),
		columnIndex(sheet, 'valor líquido'),
		columnIndex(sheet, 'valor atualizado mtm'),
		columnIndex(sheet, 'valor atualizado curva'),
		columnIndex(sheet, 'valor atualizado fechamento')
	].filter((index) => index !== -1);

	if (produto === -1 || quantidade === -1 || netCandidates.length === 0) {
		warnings.push(`Aba "${sheet.name}" ignorada: cabeçalho não reconhecido.`);
		return [];
	}

	const positions: ParsedPosition[] = [];
	for (const row of sheet.rows) {
		const rawProduct = asString(cell(row, produto));
		const qty = asNumber(cell(row, quantidade));
		if (!rawProduct || qty === null) continue;
		let netValue: number | null = null;
		for (const index of netCandidates) {
			netValue = asNumber(cell(row, index));
			if (netValue !== null) break;
		}
		if (netValue === null) {
			warnings.push(
				`"${rawProduct}" (${sheet.name}) sem valor atualizado; linha ignorada.`
			);
			continue;
		}
		const tickerGuess = normalizeProduct(rawProduct).match(
			/^([A-Z]{4}\d{1,2}[A-Z]?)\b/
		);
		const context: ResolveContext = {
			sheetClass: sheetClass(sheet.name, tickerGuess?.[1] ?? null),
			tipo: asString(cell(row, tipo)),
			code: asString(cell(row, codigo)),
			issuer: asString(cell(row, emissor))
		};
		positions.push({
			spec: resolveAssetSpec(rawProduct, context),
			rawProduct,
			institution: asString(cell(row, instituicao)),
			quantity: qty,
			closePrice: asNumber(cell(row, closePrice)),
			grossValue: asNumber(cell(row, gross)),
			netValue,
			appliedValue: asNumber(cell(row, applied))
		});
	}
	return positions;
}

// source|date|type|product|qty|total plus an occurrence index: B3 emits
// legitimately identical rows (two equal dividends on the same day), which a
// plain content hash would collapse; a row number instead would break the
// idempotency of re-uploading overlapping date ranges.
function buildDedupKeys(
	events: Omit<ParsedEvent, 'dedupKey'>[]
): ParsedEvent[] {
	const seen = new Map<string, number>();
	return events.map((event) => {
		const base = [
			event.source,
			event.eventDate,
			normalizeProduct(event.eventType),
			normalizeProduct(event.rawProduct),
			event.quantity ?? '',
			event.totalValue ?? ''
		].join('|');
		const occurrence = seen.get(base) ?? 0;
		seen.set(base, occurrence + 1);
		return { ...event, dedupKey: `${base}|${occurrence}` };
	});
}

function parseMovimentacao(sheet: B3Sheet, warnings: string[]): ParsedEvent[] {
	const entradaSaida = columnIndex(sheet, 'entrada/saída');
	const data = columnIndex(sheet, 'data');
	const movimentacao = columnIndex(sheet, 'movimentação');
	const produto = columnIndex(sheet, 'produto');
	const instituicao = columnIndex(sheet, 'instituição');
	const quantidade = columnIndex(sheet, 'quantidade');
	const preco = columnIndex(sheet, 'preço unitário');
	const valor = columnIndex(sheet, 'valor da operação');

	const events: Omit<ParsedEvent, 'dedupKey'>[] = [];
	for (const row of sheet.rows) {
		const rawProduct = asString(cell(row, produto));
		const eventDate = parseB3Date(cell(row, data));
		const eventType = asString(cell(row, movimentacao));
		if (!rawProduct || !eventType) continue;
		if (!eventDate) {
			warnings.push(
				`Linha de movimentação sem data válida ignorada ("${rawProduct}").`
			);
			continue;
		}
		const direction = /^cr[eé]dito$/i.test(
			asString(cell(row, entradaSaida)) ?? ''
		)
			? 'credit'
			: 'debit';
		events.push({
			spec: resolveAssetSpec(rawProduct),
			rawProduct,
			eventDate,
			eventType,
			direction,
			quantity: asNumber(cell(row, quantidade)),
			unitPrice: asNumber(cell(row, preco)),
			totalValue: asNumber(cell(row, valor)),
			institution: asString(cell(row, instituicao)),
			source: 'b3_movimentacao'
		});
	}
	return buildDedupKeys(events);
}

function parseNegociacao(sheet: B3Sheet, warnings: string[]): ParsedEvent[] {
	const data = columnIndex(sheet, 'data do negócio');
	const tipo = columnIndex(sheet, 'tipo de movimentação');
	const instituicao = columnIndex(sheet, 'instituição');
	const codigo = columnIndex(sheet, 'código de negociação');
	const quantidade = columnIndex(sheet, 'quantidade');
	const preco = columnIndex(sheet, 'preço');
	const valor = columnIndex(sheet, 'valor');

	const events: Omit<ParsedEvent, 'dedupKey'>[] = [];
	for (const row of sheet.rows) {
		const rawProduct = asString(cell(row, codigo));
		const eventDate = parseB3Date(cell(row, data));
		const eventType = asString(cell(row, tipo));
		if (!rawProduct || !eventType) continue;
		if (!eventDate) {
			warnings.push(
				`Linha de negociação sem data válida ignorada ("${rawProduct}").`
			);
			continue;
		}
		events.push({
			spec: resolveAssetSpec(rawProduct),
			rawProduct,
			eventDate,
			eventType,
			direction: /venda/i.test(eventType) ? 'debit' : 'credit',
			quantity: asNumber(cell(row, quantidade)),
			unitPrice: asNumber(cell(row, preco)),
			totalValue: asNumber(cell(row, valor)),
			institution: asString(cell(row, instituicao)),
			source: 'b3_negociacao'
		});
	}
	return buildDedupKeys(events);
}

export async function parseB3File(buffer: Buffer): Promise<ParsedB3File> {
	if (!isXlsx(buffer)) {
		throw new Error('O arquivo enviado não é um xlsx da B3.');
	}
	const sheets = await readB3Workbook(buffer);
	const kind = detectB3FileKind(sheets);
	if (!kind) {
		throw new Error(
			'Não foi possível reconhecer o arquivo como posição, negociação ou movimentação da B3.'
		);
	}
	const warnings: string[] = [];
	const result: ParsedB3File = { kind, positions: [], events: [], warnings };
	if (kind === 'posicao') {
		for (const sheet of sheets)
			result.positions.push(...parsePosicaoSheet(sheet, warnings));
	} else if (kind === 'movimentacao') {
		for (const sheet of sheets)
			result.events.push(...parseMovimentacao(sheet, warnings));
	} else {
		for (const sheet of sheets)
			result.events.push(...parseNegociacao(sheet, warnings));
	}
	return result;
}
