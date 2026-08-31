import { unzipSync, strFromU8 } from 'fflate';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	yahooSymbol,
	tesouroKeyFromProductName,
	tesouroMatchKey
} from './investment-quotes';
import { fundKey, onlyDigits } from './investment-funds';

// Backfills the closing prices of past months so a month's return has an
// opening mark to measure from. Same three sources the daily cron already
// uses — they all publish history, it was simply never asked for.
//
// Bank-issued fixed income (LCA/LCI/CDB) has no public price series at all, so
// it stays out: those months are reported as unmeasured rather than guessed.

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_HEADERS = {
	accept: 'application/json',
	'user-agent':
		'Mozilla/5.0 (compatible; PlannerBot/1.0; +https://github.com/talescasalta/Planner)'
};
const TESOURO_CSV_URL =
	'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';
const CVM_INFORME_URL =
	'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_';

export interface DatedPrice {
	date: string;
	price: number;
}

// Yahoo's chart endpoint returns daily candles for a range; only the closes
// matter here, and null closes (holidays inside the range) are dropped.
interface YahooChart {
	chart?: {
		result?: {
			timestamp?: number[];
			indicators?: { quote?: { close?: (number | null)[] }[] };
		}[];
	};
}

export function pricesFromYahooChart(body: unknown): DatedPrice[] {
	const result = (body as YahooChart)?.chart?.result?.[0];
	const timestamps = result?.timestamp;
	const closes = result?.indicators?.quote?.[0]?.close;
	if (!Array.isArray(timestamps) || !Array.isArray(closes)) return [];
	return timestamps.flatMap((timestamp, index) => {
		const close = closes[index];
		if (!isUsablePrice(close)) return [];
		return [
			{
				date: new Date(timestamp * 1000).toISOString().slice(0, 10),
				price: close
			}
		];
	});
}

function isUsablePrice(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function fetchTickerHistory(
	ticker: string,
	range: string,
	fetcher: typeof fetch = fetch
): Promise<DatedPrice[]> {
	const response = await fetcher(
		`${YAHOO_CHART_URL}/${yahooSymbol(ticker)}?range=${range}&interval=1d`,
		{ headers: YAHOO_HEADERS }
	);
	if (!response.ok)
		throw new Error(`${ticker}: Yahoo respondeu ${response.status}`);
	return pricesFromYahooChart(await response.json());
}

// Keeps every daily PU of the wanted bonds, not just the freshest — the whole
// point of a backfill.
export function collectTesouroHistory(
	csv: string,
	wantedKeys: Set<string>,
	since: string,
	into: Map<string, DatedPrice[]> = new Map()
): Map<string, DatedPrice[]> {
	for (const line of csv.split('\n')) {
		const row = parseTesouroLine(line);
		if (!row || row.date < since || !wantedKeys.has(row.key)) continue;
		const list = into.get(row.key) ?? [];
		list.push({ date: row.date, price: row.price });
		into.set(row.key, list);
	}
	return into;
}

function parseTesouroLine(
	line: string
): { key: string; date: string; price: number } | null {
	const cells = line.split(';');
	if (cells.length < 7) return null;
	const maturityYear = cells[1]?.slice(-4);
	if (!cells[0] || !maturityYear || !/^\d{4}$/.test(maturityYear)) return null;
	const match = cells[2]?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (!match) return null;
	const price = Number(cells[6].replace(/\./g, '').replace(',', '.'));
	if (!isUsablePrice(price)) return null;
	return {
		key: tesouroMatchKey(cells[0], maturityYear),
		date: `${match[3]}-${match[2]}-${match[1]}`,
		price
	};
}

export function collectFundHistory(
	csv: string,
	wantedKeys: Set<string>,
	into: Map<string, DatedPrice[]> = new Map()
): Map<string, DatedPrice[]> {
	for (const line of csv.split('\n')) {
		const cells = line.split(';');
		if (cells.length < 6) continue;
		const cnpj = onlyDigits(cells[1] ?? '');
		if (cnpj.length !== 14) continue;
		const key = fundKey(cnpj, cells[2]);
		if (!wantedKeys.has(key)) continue;
		const date = (cells[3] ?? '').trim();
		const price = Number(cells[5]);
		if (
			!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
			!Number.isFinite(price) ||
			price <= 0
		)
			continue;
		const list = into.get(key) ?? [];
		list.push({ date, price });
		into.set(key, list);
	}
	return into;
}

// The months whose informe files must be read to cover a start date.
export function monthsBetween(from: string, to: string): string[] {
	const months: string[] = [];
	const start = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
	const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
	for (let d = start; d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
		months.push(d.toISOString().slice(0, 7).replace('-', ''));
	}
	return months;
}

interface HistoryAsset {
	id: string;
	household_id: string;
	asset_class: string;
	ticker: string | null;
	product_key: string;
	cnpj: string | null;
	cvm_subclass_id: string | null;
}

export interface BackfillSummary {
	tickerPrices: number;
	tesouroPrices: number;
	fundPrices: number;
	inserted: number;
	errors: string[];
}

const TICKER_CLASSES = new Set(['etf', 'fii', 'acao']);

type QuoteRowInsert = {
	household_id: string;
	asset_id: string;
	quote_date: string;
	price: number;
	source: string;
};

async function tickerRows(
	assets: HistoryAsset[],
	range: string,
	summary: BackfillSummary,
	fetcher: typeof fetch
): Promise<QuoteRowInsert[]> {
	const rows: QuoteRowInsert[] = [];
	for (const asset of assets) {
		if (!asset.ticker || !TICKER_CLASSES.has(asset.asset_class)) continue;
		try {
			const prices = await fetchTickerHistory(asset.ticker, range, fetcher);
			for (const price of prices) {
				rows.push({
					household_id: asset.household_id,
					asset_id: asset.id,
					quote_date: price.date,
					price: price.price,
					source: 'yahoo'
				});
			}
			summary.tickerPrices += prices.length;
		} catch (error) {
			summary.errors.push(String((error as Error).message));
		}
	}
	return rows;
}

async function tesouroRows(
	assets: HistoryAsset[],
	since: string,
	summary: BackfillSummary,
	fetcher: typeof fetch
): Promise<QuoteRowInsert[]> {
	const wanted = new Map<string, HistoryAsset[]>();
	for (const asset of assets) {
		if (asset.asset_class !== 'tesouro') continue;
		const key = tesouroKeyFromProductName(
			asset.product_key.replace(/^TESOURO:/, '')
		);
		if (!key) continue;
		wanted.set(key, [...(wanted.get(key) ?? []), asset]);
	}
	if (wanted.size === 0) return [];
	try {
		const response = await fetcher(TESOURO_CSV_URL);
		if (!response.ok) throw new Error(`Tesouro respondeu ${response.status}`);
		const history = collectTesouroHistory(
			await response.text(),
			new Set(wanted.keys()),
			since
		);
		const rows: QuoteRowInsert[] = [];
		for (const [key, prices] of history) {
			for (const asset of wanted.get(key) ?? []) {
				for (const price of prices) {
					rows.push({
						household_id: asset.household_id,
						asset_id: asset.id,
						quote_date: price.date,
						price: price.price,
						source: 'tesouro_transparente'
					});
				}
			}
			summary.tesouroPrices += prices.length;
		}
		return rows;
	} catch (error) {
		summary.errors.push(`tesouro: ${String((error as Error).message)}`);
		return [];
	}
}

async function readInformeMonths(
	months: string[],
	wantedKeys: Set<string>,
	summary: BackfillSummary,
	fetcher: typeof fetch
): Promise<Map<string, DatedPrice[]>> {
	const history = new Map<string, DatedPrice[]>();
	for (const month of months) {
		try {
			const response = await fetcher(`${CVM_INFORME_URL}${month}.zip`);
			if (!response.ok) {
				summary.errors.push(`cvm ${month} (${response.status})`);
				continue;
			}
			const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
			for (const content of Object.values(files)) {
				collectFundHistory(strFromU8(content), wantedKeys, history);
			}
		} catch (error) {
			summary.errors.push(`cvm ${month}: ${String((error as Error).message)}`);
		}
	}
	return history;
}

async function fundRows(
	assets: HistoryAsset[],
	since: string,
	today: string,
	summary: BackfillSummary,
	fetcher: typeof fetch
): Promise<QuoteRowInsert[]> {
	const wanted = new Map<string, HistoryAsset[]>();
	for (const asset of assets) {
		if (!asset.cnpj) continue;
		const key = fundKey(asset.cnpj, asset.cvm_subclass_id);
		wanted.set(key, [...(wanted.get(key) ?? []), asset]);
	}
	if (wanted.size === 0) return [];
	const history = await readInformeMonths(
		monthsBetween(since, today),
		new Set(wanted.keys()),
		summary,
		fetcher
	);
	const rows: QuoteRowInsert[] = [];
	for (const [key, prices] of history) {
		for (const asset of wanted.get(key) ?? []) {
			for (const price of prices) {
				rows.push({
					household_id: asset.household_id,
					asset_id: asset.id,
					quote_date: price.date,
					price: price.price,
					source: 'cvm'
				});
			}
		}
		summary.fundPrices += prices.length;
	}
	return rows;
}

export async function backfillQuoteHistory(
	since: string,
	today: string = new Date().toISOString().slice(0, 10),
	range = '3mo',
	fetcher: typeof fetch = fetch
): Promise<BackfillSummary> {
	const summary: BackfillSummary = {
		tickerPrices: 0,
		tesouroPrices: 0,
		fundPrices: 0,
		inserted: 0,
		errors: []
	};
	const { data, error } = await supabaseAdmin
		.from('investment_assets')
		.select(
			'id, household_id, asset_class, ticker, product_key, cnpj, cvm_subclass_id'
		);
	if (error) {
		summary.errors.push(`assets: ${error.message}`);
		return summary;
	}
	const assets = (data ?? []) as HistoryAsset[];
	const rows = [
		...(await tickerRows(assets, range, summary, fetcher)),
		...(await tesouroRows(assets, since, summary, fetcher)),
		...(await fundRows(assets, since, today, summary, fetcher))
	];

	// Never overwrite what is already stored: a snapshot price is the official
	// B3 mark and outranks a reconstructed one.
	for (let i = 0; i < rows.length; i += 500) {
		const chunk = rows.slice(i, i + 500);
		const { data: inserted, error: upsertError } = await supabaseAdmin
			.from('investment_quotes')
			.upsert(chunk, {
				onConflict: 'asset_id,quote_date',
				ignoreDuplicates: true
			})
			.select('id');
		if (upsertError) {
			summary.errors.push(`upsert: ${upsertError.message}`);
			break;
		}
		summary.inserted += inserted?.length ?? 0;
	}
	return summary;
}
