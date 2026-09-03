import { supabaseAdmin } from '$lib/server/supabase';
import { collectFundQuoteUpserts } from './investment-funds';
import { loadCdiRates } from './investment-cdi';
import { accrualSeries, isAccruable } from './investment-accrual';

// Daily quote refresh so patrimony stays current without monthly posição
// uploads: Yahoo Finance covers B3-listed tickers (ETF/FII/ações), the Tesouro
// Transparente open dataset covers Tesouro Direto, and bank-issued fixed
// income — which has no public price at all — is accrued from its declared
// carry rate over the CDI series (see investment-accrual).

// Yahoo suffixes B3 tickers with ".SA" and serves one symbol per call, with no
// key. (brapi.dev was the obvious choice until it started charging for every
// request, including plain quotes.)
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
// Yahoo answers 429 to requests without a browser-ish User-Agent.
const YAHOO_HEADERS = {
	accept: 'application/json',
	'user-agent':
		'Mozilla/5.0 (compatible; PlannerBot/1.0; +https://github.com/talescasalta/Planner)'
};

const TESOURO_CSV_URL =
	'https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv';

interface QuoteAsset {
	id: string;
	household_id: string;
	asset_class: string;
	ticker: string | null;
	product_key: string;
	maturity_date: string | null;
	index_type: string | null;
	index_percent: number | null;
	index_spread: number | null;
}

export interface QuoteRefreshSummary {
	tickersRequested: number;
	tickerQuotes: number;
	tesouroQuotes: number;
	curvaQuotes: number;
	fundsRequested: number;
	fundQuotes: number;
	upserted: number;
	errors: string[];
}

export function yahooSymbol(ticker: string): string {
	return `${ticker.toUpperCase()}.SA`;
}

export function priceFromYahooChart(body: unknown): number | null {
	const meta = (
		body as {
			chart?: { result?: { meta?: { regularMarketPrice?: unknown } }[] };
		}
	)?.chart?.result?.[0]?.meta;
	const price = meta?.regularMarketPrice;
	return typeof price === 'number' && Number.isFinite(price) && price > 0
		? price
		: null;
}

// One call per ticker (Yahoo's chart endpoint takes a single symbol). A ticker
// that fails is skipped rather than aborting the run: the asset simply keeps
// its last known quote, which is also how unquotable fixed income behaves.
export async function fetchTickerQuotes(
	tickers: string[],
	fetcher: typeof fetch = fetch
): Promise<{ quotes: Map<string, number>; failures: string[] }> {
	const quotes = new Map<string, number>();
	const failures: string[] = [];
	for (const ticker of tickers) {
		try {
			const response = await fetcher(
				`${YAHOO_CHART_URL}/${yahooSymbol(ticker)}?range=1d&interval=1d`,
				{ headers: YAHOO_HEADERS }
			);
			if (!response.ok) {
				failures.push(`${ticker} (${response.status})`);
				continue;
			}
			const price = priceFromYahooChart(await response.json());
			if (price === null) {
				failures.push(`${ticker} (sem preço)`);
				continue;
			}
			quotes.set(ticker.toUpperCase(), price);
		} catch (error) {
			failures.push(`${ticker} (${String((error as Error).message)})`);
		}
	}
	return { quotes, failures };
}

// "Tesouro IPCA+ 2032" (our product name) ↔ CSV row (Tipo Titulo="Tesouro
// IPCA+", Data Vencimento=15/08/2032). Matching key: normalized title + year.
export function tesouroMatchKey(title: string, maturityYear: string): string {
	return `${title.toUpperCase().replace(/\s+/g, ' ').trim()} ${maturityYear}`;
}

// The year in a product name is usually the maturity, but Renda+ names the
// year the income starts: "Tesouro Renda+ Aposentadoria Extra 2065" matures in
// 2084, twenty years of payments later. Whenever the position file gave us a
// maturity, that is what the CSV is keyed by.
export function tesouroKeyFromProductName(
	name: string,
	maturityDate?: string | null
): string | null {
	const match = name.toUpperCase().match(/^(TESOURO .*?)\s*(\d{4})$/);
	if (!match) return null;
	const year = maturityDate?.slice(0, 4) ?? match[2];
	return tesouroMatchKey(match[1], year);
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
	const { quotes, failures } = await fetchTickerQuotes(tickers, fetcher);
	summary.tickerQuotes = quotes.size;
	if (failures.length > 0) summary.errors.push(`yahoo: ${failures.join(', ')}`);
	return tickerAssets.flatMap((asset) => {
		const price = quotes.get(asset.ticker!.toUpperCase());
		if (price === undefined) return [];
		return [
			{
				household_id: asset.household_id,
				asset_id: asset.id,
				quote_date: today,
				price,
				source: 'yahoo'
			}
		];
	});
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
							asset.product_key.replace(/^TESOURO:/, ''),
							asset.maturity_date
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

// The newest position row per asset, as a unit price. These sheets carry no
// unit price of their own, so it comes from net value over quantity — which is
// exactly B3's "Preço Atualizado CURVA".
function latestAnchors(
	rows: Record<string, unknown>[]
): Map<string, { date: string; price: number }> {
	const anchors = new Map<string, { date: string; price: number }>();
	for (const row of rows) {
		const assetId = row.asset_id as string;
		const quantity = Number(row.quantity);
		if (anchors.has(assetId) || !Number.isFinite(quantity) || quantity === 0)
			continue;
		anchors.set(assetId, {
			date: row.snapshot_date as string,
			price: Number(row.net_value) / quantity
		});
	}
	return anchors;
}

// Bank-issued fixed income: no public quote exists, so the price is carried
// forward from the last B3 anchor at the paper's declared rate. Papers without
// a declared rate are left alone — they stay visibly unmeasured, which is the
// honest state, and the app asks for the rate elsewhere.
async function collectCurvaUpserts(
	assets: QuoteAsset[],
	summary: QuoteRefreshSummary,
	today: string
): Promise<QuoteUpsert[]> {
	const accruable = assets.filter((asset) =>
		isAccruable({
			indexType: asset.index_type ?? '',
			percent: asset.index_percent,
			spread: asset.index_spread
		})
	);
	if (accruable.length === 0) return [];

	// The anchor is B3's own curve price on the day of the latest position
	// export: net value over quantity, since these rows carry no unit price.
	const { data: snapshots, error } = await supabaseAdmin
		.from('investment_snapshots')
		.select('asset_id, snapshot_date, quantity, net_value')
		.in(
			'asset_id',
			accruable.map((asset) => asset.id)
		)
		.order('snapshot_date', { ascending: false });
	if (error) {
		summary.errors.push(`curva: ${error.message}`);
		return [];
	}

	const anchors = latestAnchors(snapshots ?? []);
	if (anchors.size === 0) return [];

	const oldest = [...anchors.values()].reduce(
		(earliest, anchor) => (anchor.date < earliest ? anchor.date : earliest),
		today
	);
	const rates = await loadCdiRates(oldest, today);
	if (rates.length === 0) return [];

	const upserts: QuoteUpsert[] = [];
	for (const asset of accruable) {
		const anchor = anchors.get(asset.id);
		if (!anchor) continue;
		const series = accrualSeries(
			anchor,
			{
				indexType: asset.index_type ?? '',
				percent: asset.index_percent,
				spread: asset.index_spread
			},
			rates,
			today
		);
		for (const point of series) {
			upserts.push({
				household_id: asset.household_id,
				asset_id: asset.id,
				quote_date: point.date,
				price: point.price,
				source: 'curva'
			});
		}
	}
	summary.curvaQuotes = upserts.length;
	return upserts;
}

export async function refreshInvestmentQuotes(
	fetcher: typeof fetch = fetch
): Promise<QuoteRefreshSummary> {
	const summary: QuoteRefreshSummary = {
		tickersRequested: 0,
		tickerQuotes: 0,
		tesouroQuotes: 0,
		curvaQuotes: 0,
		fundsRequested: 0,
		fundQuotes: 0,
		upserted: 0,
		errors: []
	};

	const { data, error } = await supabaseAdmin
		.from('investment_assets')
		.select(
			'id, household_id, asset_class, ticker, product_key, maturity_date, index_type, index_percent, index_spread'
		);
	if (error) {
		summary.errors.push(`assets: ${error.message}`);
		return summary;
	}
	const assets = (data ?? []) as QuoteAsset[];
	const funds = await collectFundQuoteUpserts(fetcher);
	summary.fundsRequested = funds.fundsRequested;
	summary.fundQuotes = funds.fundQuotes;
	summary.errors.push(...funds.errors);
	const today = new Date().toISOString().slice(0, 10);
	const upserts = [
		...(await collectTickerUpserts(assets, summary, fetcher)),
		...(await collectTesouroUpserts(assets, summary, fetcher)),
		...(await collectCurvaUpserts(assets, summary, today)),
		...funds.upserts
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
