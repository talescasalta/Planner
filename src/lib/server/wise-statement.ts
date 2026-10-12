import Papa from 'papaparse';
import { unzipSync } from 'fflate';
import { isForeignCurrency, type ForeignCurrency } from './fx-rates';

// Reads the statement Wise exports (Conta → Extratos → CSV), either one CSV or
// the zip with one CSV per currency balance.
//
// Only the Rende+ trades matter here. Wise turns the balance into quotas of a
// money-market fund and writes each movement as an INVESTMENT_TRADE_ORDER row
// carrying the ISIN, the side, the quotas and the quota price. Everything else
// in the statement — card spending, transfers, the money that arrives before
// being invested — is deliberately ignored: the holding is what is tracked,
// not where the money came from.

export interface WiseTrade {
	id: string;
	date: string; // ISO
	side: 'BUY' | 'SELL';
	isin: string;
	units: number;
	unitPrice: number;
	currency: ForeignCurrency;
}

export interface WiseStatement {
	trades: WiseTrade[];
	warnings: string[];
}

const HEADER_MARK = 'TransferWise ID';
const TRADE_TYPE = 'INVESTMENT_TRADE_ORDER';
const BOM = String.fromCharCode(0xfeff);

function isZip(buffer: Uint8Array): boolean {
	return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function csvTexts(buffer: Uint8Array): string[] {
	if (!isZip(buffer)) return [new TextDecoder('utf-8').decode(buffer)];
	const entries = unzipSync(buffer, {
		filter: (file) => file.name.toLowerCase().endsWith('.csv')
	});
	return Object.values(entries).map((content) =>
		new TextDecoder('utf-8').decode(content)
	);
}

// Wise writes dates as DD-MM-YYYY.
function isoDate(raw: string): string | null {
	const match = raw.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
	return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function positive(raw: string): number | null {
	const value = Number(raw);
	return raw !== '' && Number.isFinite(value) && value > 0 ? value : null;
}

function cell(row: Record<string, string>, key: string): string {
	return (row[key] ?? '').trim();
}

interface TradeFields {
	id: string;
	date: string | null;
	side: string;
	isin: string;
	units: number | null;
	unitPrice: number | null;
	currency: string;
}

function tradeFields(row: Record<string, string>): TradeFields {
	const isIsin = cell(row, 'Traded Asset Id Type-0').toUpperCase() === 'ISIN';
	return {
		id: cell(row, HEADER_MARK),
		date: isoDate(cell(row, 'Date')),
		side: cell(row, 'Trade Side-0').toUpperCase(),
		isin: isIsin ? cell(row, 'Traded Asset Id Value-0').toUpperCase() : '',
		units: positive(cell(row, 'Traded Units-0')),
		unitPrice: positive(cell(row, 'Asset Base Currency Unit Price Amount-0')),
		currency: cell(
			row,
			'Asset Base Currency Unit Price Currency-0'
		).toUpperCase()
	};
}

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

function isReadable(fields: TradeFields): fields is TradeFields & {
	date: string;
	side: WiseTrade['side'];
	units: number;
	unitPrice: number;
} {
	return [
		fields.id !== '',
		fields.date !== null,
		fields.side === 'BUY' || fields.side === 'SELL',
		ISIN_PATTERN.test(fields.isin),
		fields.units !== null,
		fields.unitPrice !== null
	].every(Boolean);
}

function readTrade(
	row: Record<string, string>
): WiseTrade | { warning: string } | null {
	if (cell(row, 'Transaction Details Type') !== TRADE_TYPE) return null;
	const fields = tradeFields(row);
	if (!isReadable(fields)) {
		return {
			warning: `Movimento do Rende+ ilegível ignorado (${fields.id || 'sem ID'}).`
		};
	}
	const { currency } = fields;
	if (!isForeignCurrency(currency)) {
		return {
			warning: `Moeda ${currency || 'desconhecida'} não suportada (${fields.id}).`
		};
	}
	return { ...fields, currency };
}

export function parseWiseStatement(buffer: Uint8Array): WiseStatement {
	const texts = csvTexts(buffer);
	const trades = new Map<string, WiseTrade>();
	const warnings: string[] = [];
	let recognized = false;
	for (const text of texts) {
		const parsed = Papa.parse<Record<string, string>>(
			text.startsWith(BOM) ? text.slice(1) : text,
			{ header: true, skipEmptyLines: true }
		);
		if (!parsed.meta.fields?.includes(HEADER_MARK)) continue;
		recognized = true;
		for (const row of parsed.data) {
			const result = readTrade(row);
			if (!result) continue;
			if ('warning' in result) warnings.push(result.warning);
			// The zip repeats nothing across currencies, but the same file sent
			// twice in one upload must not double the quotas.
			else trades.set(result.id, result);
		}
	}
	if (!recognized) {
		throw new Error(
			'Não reconheci o extrato da Wise. Exporte em Extratos → CSV (ou o .zip) e envie sem alterar.'
		);
	}
	return {
		trades: [...trades.values()].sort((a, b) =>
			a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1
		),
		warnings
	};
}
