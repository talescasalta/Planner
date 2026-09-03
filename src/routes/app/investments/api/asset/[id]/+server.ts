import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import { loadCdiRates } from '$lib/server/investment-cdi';
import { monthReturn, recentMonths } from '$lib/server/investment-monthly';
import {
	loadInvestmentRows,
	valuePositions
} from '$lib/server/investment-overview';
import { computeTaxReport, type TaxAssetRow } from '$lib/server/investment-tax';
import type { QuoteRow } from '$lib/server/investment-positions';

// Detail for one holding, fetched when the user opens it from the treemap or
// the positions table. Read with the user's own client (RLS) and additionally
// scoped by household, like every other read in this section.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY_MONTHS = 6;
const RECENT_EVENTS = 20;
const PRICE_DAYS = 365;

// One point per day, preferring a real quote over the B3 snapshot's price.
function priceSeries(quotes: QuoteRow[], since: string) {
	const byDate = new Map<string, { price: number; snapshot: boolean }>();
	for (const quote of quotes) {
		if (quote.quote_date < since) continue;
		const existing = byDate.get(quote.quote_date);
		const snapshot = quote.source === 'snapshot';
		if (!existing || (existing.snapshot && !snapshot)) {
			byDate.set(quote.quote_date, { price: Number(quote.price), snapshot });
		}
	}
	return [...byDate.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([date, point]) => ({ date, price: point.price }));
}

export const GET: RequestHandler = async ({
	params,
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) error(401, 'Não autenticado');
	if (!UUID.test(params.id)) error(400, 'Ativo inválido');
	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) error(400, 'Usuário não pertence a um grupo');

	const rows = await loadInvestmentRows(supabase, householdId, [params.id]);
	const asset = rows.assets[0];
	if (!asset) error(404, 'Ativo não encontrado');

	const today = new Date().toISOString().slice(0, 10);
	const months = recentMonths(today, HISTORY_MONTHS);
	const rates = await loadCdiRates(`${months.at(-1)}-01`, today);
	const position = valuePositions(rows)[0];
	const cost = computeTaxReport([asset as TaxAssetRow], rows.events).costs[0];
	const since = new Date(Date.now() - PRICE_DAYS * 86400000)
		.toISOString()
		.slice(0, 10);

	const history = months
		.map((month) => {
			const result = monthReturn(
				[asset.id],
				month,
				today,
				rows.snapshots,
				rows.events,
				rows.quotes,
				rates
			);
			const own = result.assets[0];
			return own
				? {
						month,
						gain: own.gain,
						returnRate: own.returnRate,
						percentOfCdi: own.percentOfCdi,
						cdiRate: result.cdiRate,
						unpriced: own.unpriced
					}
				: null;
		})
		.filter((row) => row !== null);

	const events = [...rows.events]
		.sort((a, b) => (a.event_date < b.event_date ? 1 : -1))
		.slice(0, RECENT_EVENTS)
		.map((event) => ({
			date: event.event_date,
			type: event.event_type,
			direction: event.direction,
			quantity: event.quantity === null ? null : Number(event.quantity),
			total: event.total_value === null ? null : Number(event.total_value)
		}));

	return json({
		asset: {
			id: asset.id,
			label: asset.ticker ?? asset.name,
			name: asset.name,
			assetClass: asset.asset_class,
			ownerUserId: asset.owner_user_id,
			taxBucket: asset.tax_bucket
		},
		quantity: position.quantity,
		price: position.price,
		priceDate: position.priceDate,
		value: position.value,
		averageCost: cost?.averageCost ?? null,
		totalCost:
			cost && cost.averageCost !== null
				? cost.averageCost * position.quantity
				: null,
		prices: priceSeries(rows.quotes, since),
		history,
		events
	});
};
