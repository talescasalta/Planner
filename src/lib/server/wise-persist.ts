import { supabaseAdmin } from '$lib/server/supabase';
import {
	fxOn,
	isForeignCurrency,
	loadFxFor,
	type ForeignCurrency
} from './fx-rates';
import type { WiseStatement, WiseTrade } from './wise-statement';

// Persists the Rende+ side of a Wise statement for one owner. Writes go through
// supabaseAdmin (service role), so every statement filters household_id
// explicitly — RLS is not the guard on this path (see SECURITY.md).
//
// Each trade becomes a compra/venda event priced in reais at the PTAX of its
// day, so positions, returns and the monthly curve read it like any purchase.
// The quota Wise traded at is also a quote, the anchor the daily valuation
// accrues from.

export interface WisePersistResult {
	inserted: number;
	skippedDuplicates: number;
	assetsCreated: number;
	errorMessage?: string;
}

function wiseProductKey(isin: string): string {
	return `ISIN:${isin}`;
}

async function resolveWiseAssets(
	householdId: string,
	ownerUserId: string,
	trades: WiseTrade[]
): Promise<
	{ byIsin: Map<string, string>; created: number } | { errorMessage: string }
> {
	const currencyByIsin = new Map(trades.map((t) => [t.isin, t.currency]));
	const keys = [...currencyByIsin.keys()].map(wiseProductKey);
	const { data: existing, error } = await supabaseAdmin
		.from('investment_assets')
		.select('id, isin')
		.eq('household_id', householdId)
		.eq('owner_user_id', ownerUserId)
		.in('product_key', keys);
	if (error) return { errorMessage: error.message };

	const byIsin = new Map<string, string>(
		(existing ?? []).map((row) => [row.isin as string, row.id as string])
	);
	const missing = [...currencyByIsin.keys()].filter(
		(isin) => !byIsin.has(isin)
	);
	if (missing.length > 0) {
		const { data: inserted, error: insertError } = await supabaseAdmin
			.from('investment_assets')
			.insert(
				missing.map((isin) => ({
					household_id: householdId,
					owner_user_id: ownerUserId,
					asset_class: 'exterior',
					name: `Wise Rende+ ${currencyByIsin.get(isin)}`,
					product_key: wiseProductKey(isin),
					issuer: 'Wise',
					tax_bucket: 'exterior',
					currency: currencyByIsin.get(isin),
					isin
				}))
			)
			.select('id, isin');
		if (insertError) return { errorMessage: insertError.message };
		for (const row of inserted ?? [])
			byIsin.set(row.isin as string, row.id as string);
	}
	return { byIsin, created: missing.length };
}

interface PricedTrade {
	trade: WiseTrade;
	fx: number;
}

function noPtax(date: string, errors: string[]): { errorMessage: string } {
	const detail = errors.length > 0 ? ` (${errors.join('; ')})` : '';
	return {
		errorMessage: `Sem PTAX para ${date}. Tente de novo em instantes${detail}.`
	};
}

// Every trade at the PTAX of its own day, or the first day that has none.
async function priceTrades(
	trades: WiseTrade[]
): Promise<PricedTrade[] | { errorMessage: string }> {
	const { rates, errors } = await loadFxFor(
		trades.map((trade) => trade.currency),
		trades[0].date,
		trades[trades.length - 1].date
	);
	const priced: PricedTrade[] = [];
	for (const trade of trades) {
		const fx = fxOn(rates.get(trade.currency) ?? [], trade.date);
		if (fx === null) return noPtax(trade.date, errors);
		priced.push({ trade, fx });
	}
	return priced;
}

async function createImport(
	householdId: string,
	ownerUserId: string,
	sourceFilename: string,
	rowCount: number
): Promise<string | { errorMessage: string }> {
	const { data, error } = await supabaseAdmin
		.from('transaction_imports')
		.insert({
			household_id: householdId,
			created_by_user_id: ownerUserId,
			source_filename: sourceFilename,
			source_type: 'wise_extrato',
			status: 'parsed',
			row_count: rowCount
		})
		.select('id')
		.single();
	if (error || !data)
		return { errorMessage: error?.message ?? 'Falha ao registrar o import.' };
	return data.id as string;
}

function eventRow(
	householdId: string,
	assetId: string,
	importId: string,
	{ trade, fx }: PricedTrade
) {
	const buy = trade.side === 'BUY';
	return {
		household_id: householdId,
		asset_id: assetId,
		event_date: trade.date,
		event_type: buy ? 'Compra' : 'Venda',
		direction: buy ? 'credit' : 'debit',
		quantity: trade.units,
		unit_price: trade.unitPrice * fx,
		total_value: trade.units * trade.unitPrice * fx,
		native_unit_price: trade.unitPrice,
		native_total_value: trade.units * trade.unitPrice,
		institution: 'Wise',
		raw_product: `Rende+ ${trade.currency} (${trade.isin})`,
		source: 'wise_extrato',
		dedup_key: `wise|${trade.id}`,
		import_id: importId
	};
}

async function writeTrades(
	householdId: string,
	byIsin: Map<string, string>,
	importId: string,
	priced: PricedTrade[]
): Promise<number | { errorMessage: string }> {
	const { data, error } = await supabaseAdmin
		.from('investment_events')
		.upsert(
			priced.map((item) =>
				eventRow(householdId, byIsin.get(item.trade.isin)!, importId, item)
			),
			{ onConflict: 'household_id,dedup_key', ignoreDuplicates: true }
		)
		.select('id');
	if (error) return { errorMessage: error.message };

	// The last trade of each day per fund: the quota Wise itself used.
	const anchors = new Map<string, PricedTrade>();
	for (const item of priced)
		anchors.set(`${item.trade.isin}|${item.trade.date}`, item);
	const { error: quoteError } = await supabaseAdmin
		.from('investment_quotes')
		.upsert(
			[...anchors.values()].map(({ trade, fx }) => ({
				household_id: householdId,
				asset_id: byIsin.get(trade.isin)!,
				quote_date: trade.date,
				price: trade.unitPrice * fx,
				native_price: trade.unitPrice,
				source: 'wise'
			})),
			{ onConflict: 'asset_id,quote_date' }
		);
	if (quoteError) return { errorMessage: quoteError.message };
	return data?.length ?? 0;
}

const NO_TRADES =
	'O extrato não tem movimentos do Rende+ neste período. Exporte um período que inclua a ativação ou novos aportes.';

export async function persistWiseStatement(
	householdId: string,
	ownerUserId: string,
	statement: WiseStatement,
	sourceFilename: string
): Promise<WisePersistResult> {
	const empty = { inserted: 0, skippedDuplicates: 0, assetsCreated: 0 };
	const { trades } = statement;
	if (trades.length === 0) return { ...empty, errorMessage: NO_TRADES };

	const priced = await priceTrades(trades);
	if ('errorMessage' in priced) return { ...empty, ...priced };

	const importId = await createImport(
		householdId,
		ownerUserId,
		sourceFilename,
		trades.length
	);
	if (typeof importId !== 'string') return { ...empty, ...importId };
	const failure = async (message: string): Promise<WisePersistResult> => {
		console.error('[investments/exterior]', message);
		await supabaseAdmin
			.from('transaction_imports')
			.update({ status: 'failed' })
			.eq('id', importId);
		return { ...empty, errorMessage: message };
	};

	const assets = await resolveWiseAssets(householdId, ownerUserId, trades);
	if ('errorMessage' in assets) return failure(assets.errorMessage);
	const inserted = await writeTrades(
		householdId,
		assets.byIsin,
		importId,
		priced
	);
	if (typeof inserted !== 'number') return failure(inserted.errorMessage);
	return {
		inserted,
		skippedDuplicates: trades.length - inserted,
		assetsCreated: assets.created
	};
}

export interface RendeBalanceInput {
	assetId: string;
	balance: number;
	ratePercent: number | null;
	date: string;
}

// Quotas held on a date: the statement's trades are the only thing that moves
// a Rende+ holding.
export function unitsOn(
	events: { event_date: string; direction: string; quantity: number | null }[],
	date: string
): number {
	let units = 0;
	for (const event of events) {
		if (event.event_date > date) continue;
		const quantity = Number(event.quantity ?? 0);
		units += event.direction === 'credit' ? quantity : -quantity;
	}
	return units;
}

async function ownedCurrency(
	householdId: string,
	ownerUserId: string,
	assetId: string
): Promise<ForeignCurrency | { errorMessage: string }> {
	const { data, error } = await supabaseAdmin
		.from('investment_assets')
		.select('currency')
		.eq('id', assetId)
		.eq('household_id', householdId)
		.eq('owner_user_id', ownerUserId)
		.maybeSingle();
	if (error || !data)
		return { errorMessage: 'Saldo do Rende+ não encontrado.' };
	const currency = data.currency as string;
	return isForeignCurrency(currency)
		? currency
		: { errorMessage: 'Este ativo não é em moeda estrangeira.' };
}

async function heldUnits(
	householdId: string,
	assetId: string,
	date: string
): Promise<number | { errorMessage: string }> {
	const { data, error } = await supabaseAdmin
		.from('investment_events')
		.select('event_date, direction, quantity')
		.eq('household_id', householdId)
		.eq('asset_id', assetId);
	if (error) return { errorMessage: error.message };
	const units = unitsOn(data ?? [], date);
	return units > 0
		? units
		: {
				errorMessage:
					'Ainda não sei quantas cotas existem nessa data. Importe o extrato da Wise do período primeiro.'
			};
}

async function writeBalanceAnchor(
	householdId: string,
	input: RendeBalanceInput,
	nativePrice: number,
	fx: number
): Promise<string | null> {
	const { error } = await supabaseAdmin.from('investment_quotes').upsert(
		{
			household_id: householdId,
			asset_id: input.assetId,
			quote_date: input.date,
			price: nativePrice * fx,
			native_price: nativePrice,
			source: 'wise'
		},
		{ onConflict: 'asset_id,quote_date' }
	);
	if (error || input.ratePercent === null) return error?.message ?? null;
	const { error: rateError } = await supabaseAdmin
		.from('investment_assets')
		.update({
			index_type: 'pre',
			index_percent: input.ratePercent,
			index_spread: null
		})
		.eq('id', input.assetId)
		.eq('household_id', householdId);
	return rateError?.message ?? null;
}

// A balance read from the app turns into the quota of the day — balance over
// the quotas the statement accounts for — and becomes the newest anchor. The
// rate on the same screen replaces the declared one, so the days until the
// next update accrue at the pace Wise currently shows.
export async function saveRendeBalance(
	householdId: string,
	ownerUserId: string,
	input: RendeBalanceInput
): Promise<{ nativePrice: number; units: number } | { errorMessage: string }> {
	const currency = await ownedCurrency(householdId, ownerUserId, input.assetId);
	if (typeof currency !== 'string') return currency;
	const units = await heldUnits(householdId, input.assetId, input.date);
	if (typeof units !== 'number') return units;

	const { rates, errors } = await loadFxFor([currency], input.date, input.date);
	const fx = fxOn(rates.get(currency) ?? [], input.date);
	if (fx === null) return noPtax(input.date, errors);

	const nativePrice = input.balance / units;
	const error = await writeBalanceAnchor(householdId, input, nativePrice, fx);
	return error ? { errorMessage: error } : { nativePrice, units };
}
