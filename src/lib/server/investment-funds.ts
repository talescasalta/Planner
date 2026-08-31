import { unzipSync, strFromU8 } from 'fflate';
import { supabaseAdmin } from '$lib/server/supabase';

// Daily quotas for open-ended funds and previdência plans, from the CVM's
// informe diário. Free and unauthenticated, one zipped CSV per month covering
// every registered fund (~25k). Published with roughly two business days of
// lag, which is why valuation always takes the freshest row rather than
// insisting on a particular date.

const INFORME_URL =
	'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_';

export function onlyDigits(cnpj: string): string {
	return cnpj.replace(/\D/g, '');
}

export function formatCnpj(cnpj: string): string {
	const digits = onlyDigits(cnpj);
	if (digits.length !== 14) return cnpj;
	return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

// A fund's identity is CNPJ plus subclass: the same CNPJ can publish several
// quotas, and picking the wrong one silently tracks a different series.
export function fundKey(cnpj: string, subclassId?: string | null): string {
	return `${onlyDigits(cnpj)}|${(subclassId ?? '').trim()}`;
}

export interface FundQuote {
	key: string;
	date: string;
	quota: number;
}

// TP_FUNDO_CLASSE;CNPJ_FUNDO_CLASSE;ID_SUBCLASSE;DT_COMPTC;VL_TOTAL;VL_QUOTA;...
export function parseInformeLine(line: string): FundQuote | null {
	const cells = line.split(';');
	if (cells.length < 6) return null;
	const cnpj = onlyDigits(cells[1] ?? '');
	const date = (cells[3] ?? '').trim();
	const quota = Number(cells[5]);
	if (cnpj.length !== 14) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
	if (!Number.isFinite(quota) || quota <= 0) return null;
	return { key: fundKey(cnpj, cells[2]), date, quota };
}

// Keeps the freshest quota per wanted fund. The monthly file is ~43 MB of text
// with 400k rows, so nothing but the matches is retained.
export function collectLatestQuotes(
	csv: string,
	wantedKeys: Set<string>,
	into: Map<string, FundQuote> = new Map()
): Map<string, FundQuote> {
	for (const line of csv.split('\n')) {
		const quote = parseInformeLine(line);
		if (!quote || !wantedKeys.has(quote.key)) continue;
		const current = into.get(quote.key);
		if (!current || quote.date > current.date) into.set(quote.key, quote);
	}
	return into;
}

export function informeMonths(today: Date, howMany = 2): string[] {
	const months: string[] = [];
	for (let back = 0; back < howMany; back++) {
		const date = new Date(
			Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1)
		);
		months.push(
			`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`
		);
	}
	return months;
}

export async function fetchCvmQuotes(
	wantedKeys: Set<string>,
	months: string[],
	fetcher: typeof fetch = fetch
): Promise<{ quotes: Map<string, FundQuote>; errors: string[] }> {
	const quotes = new Map<string, FundQuote>();
	const errors: string[] = [];
	if (wantedKeys.size === 0) return { quotes, errors };
	// Oldest month first so the newest rows win the freshness comparison.
	for (const month of [...months].reverse()) {
		try {
			const response = await fetcher(`${INFORME_URL}${month}.zip`);
			if (!response.ok) {
				errors.push(`${month} (${response.status})`);
				continue;
			}
			const zipped = new Uint8Array(await response.arrayBuffer());
			const files = unzipSync(zipped);
			for (const content of Object.values(files)) {
				collectLatestQuotes(strFromU8(content), wantedKeys, quotes);
			}
		} catch (error) {
			errors.push(`${month} (${String((error as Error).message)})`);
		}
	}
	return { quotes, errors };
}

interface FundAsset {
	id: string;
	household_id: string;
	cnpj: string;
	cvm_subclass_id: string | null;
}

export interface FundQuoteSummary {
	fundsRequested: number;
	fundQuotes: number;
	errors: string[];
	upserts: {
		household_id: string;
		asset_id: string;
		quote_date: string;
		price: number;
		source: string;
	}[];
}

export async function collectFundQuoteUpserts(
	fetcher: typeof fetch = fetch,
	today: Date = new Date()
): Promise<FundQuoteSummary> {
	const summary: FundQuoteSummary = {
		fundsRequested: 0,
		fundQuotes: 0,
		errors: [],
		upserts: []
	};
	const { data, error } = await supabaseAdmin
		.from('investment_assets')
		.select('id, household_id, cnpj, cvm_subclass_id')
		.not('cnpj', 'is', null);
	if (error) {
		summary.errors.push(`fund assets: ${error.message}`);
		return summary;
	}
	const assets = (data ?? []) as FundAsset[];
	summary.fundsRequested = assets.length;
	if (assets.length === 0) return summary;

	const wanted = new Set(
		assets.map((asset) => fundKey(asset.cnpj, asset.cvm_subclass_id))
	);
	const { quotes, errors } = await fetchCvmQuotes(
		wanted,
		informeMonths(today),
		fetcher
	);
	summary.fundQuotes = quotes.size;
	if (errors.length > 0) summary.errors.push(`cvm: ${errors.join(', ')}`);

	for (const asset of assets) {
		const quote = quotes.get(fundKey(asset.cnpj, asset.cvm_subclass_id));
		if (!quote) continue;
		summary.upserts.push({
			household_id: asset.household_id,
			asset_id: asset.id,
			quote_date: quote.date,
			price: quote.quota,
			source: 'cvm'
		});
	}
	return summary;
}
