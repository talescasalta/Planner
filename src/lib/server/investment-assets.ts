// Resolves B3 "Produto" strings into stable asset identities.
//
// The same holding shows up spelled differently across the three exports
// ("BOVA11 - ISHARES IBOVESPA FUNDO DE ÍNDICE" in posição, "BOVA11" in
// negociação, "CDB - CDB7260RWBT - ITAU..." in movimentação), so everything
// funnels into a normalized product_key that investment_assets is unique on.

export type AssetClass =
	| 'etf'
	| 'fii'
	| 'acao'
	| 'fundo'
	| 'previdencia'
	| 'tesouro'
	| 'cdb'
	| 'lca_lci'
	| 'outro';

export type TaxBucket = 'fii' | 'acoes' | 'etf_rv' | 'retido_fonte' | 'isento';

export interface AssetSpec {
	productKey: string;
	name: string;
	ticker: string | null;
	issuer: string | null;
	assetClass: AssetClass;
	taxBucket: TaxBucket;
	// True when the class came from a heuristic instead of an authoritative
	// posição sheet — surfaced in the import preview so the user can fix it.
	classGuessed: boolean;
}

// B3 roots are usually 4 letters (BOVA11) but ETF roots may carry digits
// (NB0211, B5P211, IB5M11) — hence [A-Z0-9]{3} after the leading letter.
export const TICKER_PATTERN = /^([A-Z][A-Z0-9]{3}\d{1,2}[A-Z]?)\b/;
const FIXED_INCOME_PREFIX =
	/^(CDB|LCA|LCI|LC|RDB|CRA|CRI|DEB(?:ÊNTURE)?)\s*-\s*/i;

export function normalizeProduct(raw: string): string {
	return raw.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function defaultTaxBucket(
	assetClass: AssetClass,
	tipo?: string | null
): TaxBucket {
	switch (assetClass) {
		case 'fii':
			return 'fii';
		case 'acao':
			return 'acoes';
		case 'etf':
			// The posição ETF sheet's "Tipo" column distinguishes renda fixa
			// ETFs (taxed at source on sale — no DARF) from equity ones.
			return tipo && /renda fixa/i.test(tipo) ? 'retido_fonte' : 'etf_rv';
		case 'lca_lci':
			return 'isento';
		// Previdência is withheld by the insurer under the regressive table;
		// the others by the administrator (come-cotas or on redemption).
		case 'tesouro':
		case 'cdb':
		case 'fundo':
		case 'previdencia':
			return 'retido_fonte';
		case 'outro':
			// Deliberately conservative: never compute a DARF for something we
			// could not classify. The preview flags these for manual review.
			return 'retido_fonte';
	}
}

export interface ResolveContext {
	// Authoritative class when the row came from a posição sheet.
	sheetClass?: AssetClass;
	// Value of the sheet's "Tipo" column, used to split ETF tax buckets.
	tipo?: string | null;
	// Renda Fixa posição rows carry the paper's code in a dedicated column.
	code?: string | null;
	issuer?: string | null;
}

function resolveTesouro(
	normalized: string,
	context: ResolveContext
): AssetSpec {
	return {
		productKey: `TESOURO:${normalized}`,
		name: normalized,
		ticker: null,
		issuer: context.issuer ?? null,
		assetClass: 'tesouro',
		taxBucket: defaultTaxBucket('tesouro'),
		classGuessed: false
	};
}

function fixedIncomeClass(prefix: string): AssetClass {
	if (prefix === 'CDB' || prefix === 'RDB') return 'cdb';
	if (/^(LCA|LCI|LC)$/.test(prefix)) return 'lca_lci';
	return 'outro';
}

// Bank-issued fixed income: "CDB - CDB7260RWBT - ITAU UNIBANCO S.A."
// (movimentação) or "LCA - BANCO ABC BRASIL S.A." + code column (posição).
function resolveFixedIncome(
	normalized: string,
	prefixMatch: RegExpMatchArray,
	context: ResolveContext
): AssetSpec {
	const prefix = prefixMatch[1].replace('DEBÊNTURE', 'DEB');
	const parts = normalized.slice(prefixMatch[0].length).split(/\s*-\s*/);
	const code = context.code
		? normalizeProduct(context.code)
		: parts.length > 1
			? parts[0]
			: null;
	const issuer =
		context.issuer ??
		(parts.length > 1 ? parts.slice(1).join(' - ') : parts[0]);
	const assetClass = fixedIncomeClass(prefix);
	return {
		// Without a code (posição names only the issuer) the issuer keeps
		// papers from collapsing, though two same-issuer papers still need
		// the code column to stay distinct.
		productKey: `${prefix}:${code ?? issuer}`,
		name: normalized,
		ticker: null,
		issuer,
		assetClass,
		taxBucket: defaultTaxBucket(assetClass),
		classGuessed: assetClass === 'outro'
	};
}

// Movimentação/negociação rows carry no class. Suffix heuristics: 3-8 = ação
// (ON/PN/units/BDR patterns); 11 is ambiguous between ETF and FII — FII is the
// commoner retail case, and a posição import corrects it authoritatively.
function guessTickerClass(symbol: string): AssetClass {
	const suffix = symbol.match(/\d+/)?.[0] ?? '';
	if (suffix === '11') return 'fii';
	return /^[345678]$/.test(suffix) ? 'acao' : 'outro';
}

// Listed assets: ticker prefix ("BOVA11 - ISHARES ...", or bare "BOVA11").
function resolveTicker(
	normalized: string,
	symbol: string,
	context: ResolveContext
): AssetSpec {
	const name = normalized.includes(' - ')
		? normalized.slice(normalized.indexOf(' - ') + 3)
		: normalized;
	const assetClass = context.sheetClass ?? guessTickerClass(symbol);
	return {
		productKey: symbol,
		name,
		ticker: symbol,
		issuer: context.issuer ?? null,
		assetClass,
		taxBucket: defaultTaxBucket(assetClass, context.tipo),
		classGuessed: !context.sheetClass
	};
}

export function resolveAssetSpec(
	rawProduct: string,
	context: ResolveContext = {}
): AssetSpec {
	const normalized = normalizeProduct(rawProduct);
	if (normalized.startsWith('TESOURO '))
		return resolveTesouro(normalized, context);
	const fixedIncome = normalized.match(FIXED_INCOME_PREFIX);
	if (fixedIncome) return resolveFixedIncome(normalized, fixedIncome, context);
	const ticker = normalized.match(TICKER_PATTERN);
	if (ticker) return resolveTicker(normalized, ticker[1], context);
	return {
		productKey: normalized,
		name: normalized,
		ticker: null,
		issuer: context.issuer ?? null,
		assetClass: 'outro',
		taxBucket: defaultTaxBucket('outro'),
		classGuessed: true
	};
}
