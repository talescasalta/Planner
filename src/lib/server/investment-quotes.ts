import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabase';

// Daily quote refresh so patrimony stays current without monthly posição
// uploads: brapi.dev covers B3-listed tickers (ETF/FII/ações), the Tesouro
// Transparente open dataset covers Tesouro Direto. Bank-issued fixed income
// has no public price — valuation falls back to the last snapshot value.

const BRAPI_URL = 'https://brapi.dev/api/quote';
const TESOURO_CSV_URL =
	'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';

interface QuoteAsset {
	id: string;
	household_id: string;
	asset_class: string;
	ticker: string | null;
	product_key: string;
}

export interface QuoteRefreshSummary {
	tickersRequested: number;
	tickerQuotes: number;
	tesouroQuotes: number;
	upserted: number;
	errors: string[];
}

// One batched call per run; per-ticker absence is tolerated (delisted paper,
// brapi hiccup) — the asset just keeps its last known quote.
export async function fetchBrapiQuotes(
	tickers: string[],
	fetcher: typeof fetch = fetch
): Promise<Map<string, number>> {
	const quotes = new Map<string, number>();
	if (tickers.length === 0) return quotes;
	const token = env.BRAPI_TOKEN?.trim();
	const url = `${BRAPI_URL}/${tickers.join(',')}${token ? `?token=${token}` : ''}`;
	const response = await fetcher(url, {
		headers: { accept: 'application/json' }
	});
	if (!response.ok) throw new Error(`brapi respondeu ${response.status}`);
	const body = (await response.json()) as {
		results?: { symbol?: string; regularMarketPrice?: number }[];
	};
	for (const result of body.results ?? []) {
		if (result.symbol && typeof result.regularMarketPrice === 'number') {
			quotes.set(result.symbol.toUpperCase(), result.regularMarketPrice);
		}
	}
	return quotes;
}

// "Tesouro IPCA+ 2032" (our product name) ↔ CSV row (Tipo Titulo="Tesouro
// IPCA+", Data Vencimento=15/08/2032). Matching key: normalized title + year.
export function tesouroMatchKey(title: string, maturityYear: string): string {
	return `${title.toUpperCase().replace(/\s+/g, ' ').trim()} ${maturityYear}`;
}

export function tesouroKeyFromProductName(name: string): string | null {
	const match = name.toUpperCase().match(/^(TESOURO .*?)\s*(\d{4})$/);
	return match ? tesouroMatchKey(match[1], match[2]) : null;
}

// Streams the cumulative CSV (semicolon-separated, decimal comma, no quoted
// fields) keeping only the freshest PU Venda per wanted bond — the file has
// two decades of rows, so nothing is accumulated besides the matches.
export async function fetchTesouroQuotes(
	wantedKeys: Set<string>,
	fetcher: typeof fetch = fetch
): Promise<Map<string, { price: number; date: string }>> {
	const best = new Map<string, { price: number; date: string }>();
	if (wantedKeys.size === 0) return best;
	const response = await fetcher(TESOURO_CSV_URL);
	if (!response.ok || !response.body) {
		throw new Error(`Tesouro Transparente respondeu ${response.status}`);
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder('utf-8');
	let tail = '';
	for (;;) {
		const { done, value } = await reader.read();
		const chunk =
			tail + (value ? decoder.decode(value, { stream: !done }) : '');
		const lines = chunk.split('\n');
		tail = done ? '' : (lines.pop() ?? '');
		for (const line of lines) ingestTesouroCsvLine(line, wantedKeys, best);
		if (done) break;
	}
	if (tail) ingestTesouroCsvLine(tail, wantedKeys, best);
	return best;
}

interface TesouroCsvRow {
	key: string;
	date: string;
	price: number;
}

// Tipo Titulo;Data Vencimento;Data Base;Taxa Compra;Taxa Venda;PU Compra;PU Venda;PU Base
function parseTesouroCsvLine(line: string): TesouroCsvRow | null {
	const cells = line.split(';');
	if (cells.length < 7) return null;
	const [title, maturity, baseDate] = cells;
	const maturityYear = maturity?.slice(-4);
	if (!title || !maturityYear || !/^\d{4}$/.test(maturityYear)) return null;
	const dateMatch = baseDate?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
	if (!dateMatch) return null;
	const price = Number(cells[6].replace(/\./g, '').replace(',', '.'));
	if (!Number.isFinite(price) || price <= 0) return null;
	return {
		key: tesouroMatchKey(title, maturityYear),
		date: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`,
		price
	};
}

export function ingestTesouroCsvLine(
	line: string,
	wantedKeys: Set<string>,
	best: Map<string, { price: number; date: string }>
) {
	const row = parseTesouroCsvLine(line);
	if (!row || !wantedKeys.has(row.key)) return;
	const current = best.get(row.key);
	if (!current || row.date > current.date)
		best.set(row.key, { price: row.price, date: row.date });
}

const TICKER_CLASSES = new Set(['etf', 'fii', 'acao', 'fundo']);

interface QuoteUpsert {
	household_id: string;
	asset_id: string;
	quote_date: string;
	price: number;
	source: string;
}

async function collectTickerUpserts(
	assets: QuoteAsset[],
	summary: QuoteRefreshSummary,
	fetcher: typeof fetch
): Promise<QuoteUpsert[]> {
	const tickerAssets = assets.filter(
		(asset) => asset.ticker && TICKER_CLASSES.has(asset.asset_class)
	);
	const tickers = [
		...new Set(tickerAssets.map((asset) => asset.ticker!.toUpperCase()))
	];
	summary.tickersRequested = tickers.length;
	if (tickers.length === 0) return [];
	const today = new Date().toISOString().slice(0, 10);
	try {
		const quotes = await fetchBrapiQuotes(tickers, fetcher);
		summary.tickerQuotes = quotes.size;
		return tickerAssets.flatMap((asset) => {
			const price = quotes.get(asset.ticker!.toUpperCase());
			if (price === undefined) return [];
			return [
				{
					household_id: asset.household_id,
					asset_id: asset.id,
					quote_date: today,
					price,
					source: 'brapi'
				}
			];
		});
	} catch (error) {
		summary.errors.push(`brapi: ${String((error as Error).message)}`);
		return [];
	}
}

async function collectTesouroUpserts(
	assets: QuoteAsset[],
	summary: QuoteRefreshSummary,
	fetcher: typeof fetch
): Promise<QuoteUpsert[]> {
	const tesouroAssets = assets
		.map((asset) => ({
			asset,
			key:
				asset.asset_class === 'tesouro'
					? tesouroKeyFromProductName(
							asset.product_key.replace(/^TESOURO:/, '')
						)
					: null
		}))
		.filter(
			(entry): entry is { asset: QuoteAsset; key: string } => entry.key !== null
		);
	if (tesouroAssets.length === 0) return [];
	try {
		const quotes = await fetchTesouroQuotes(
			new Set(tesouroAssets.map((entry) => entry.key)),
			fetcher
		);
		summary.tesouroQuotes = quotes.size;
		return tesouroAssets.flatMap(({ asset, key }) => {
			const quote = quotes.get(key);
			if (!quote) return [];
			return [
				{
					household_id: asset.household_id,
					asset_id: asset.id,
					quote_date: quote.date,
					price: quote.price,
					source: 'tesouro_transparente'
				}
			];
		});
	} catch (error) {
		summary.errors.push(`tesouro: ${String((error as Error).message)}`);
		return [];
	}
}

export async function refreshInvestmentQuotes(
	fetcher: typeof fetch = fetch
): Promise<QuoteRefreshSummary> {
	const summary: QuoteRefreshSummary = {
		tickersRequested: 0,
		tickerQuotes: 0,
		tesouroQuotes: 0,
		upserted: 0,
		errors: []
	};

	const { data, error } = await supabaseAdmin
		.from('investment_assets')
		.select('id, household_id, asset_class, ticker, product_key');
	if (error) {
		summary.errors.push(`assets: ${error.message}`);
		return summary;
	}
	const assets = (data ?? []) as QuoteAsset[];
	const upserts = [
		...(await collectTickerUpserts(assets, summary, fetcher)),
		...(await collectTesouroUpserts(assets, summary, fetcher))
	];

	if (upserts.length > 0) {
		const { error: upsertError, data: upserted } = await supabaseAdmin
			.from('investment_quotes')
			.upsert(upserts, {
				onConflict: 'asset_id,quote_date',
				ignoreDuplicates: false
			})
			.select('id');
		if (upsertError) summary.errors.push(`upsert: ${upsertError.message}`);
		else summary.upserted = upserted?.length ?? 0;
	}

	return summary;
}
