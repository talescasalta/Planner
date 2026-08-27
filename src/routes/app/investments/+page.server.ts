import type { PageServerLoad } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import {
	deriveQuantity,
	evolutionSeries,
	latestPrice,
	monthlyPassiveIncome,
	type EventRow,
	type QuoteRow,
	type SnapshotRow
} from '$lib/server/investment-positions';
import { computeTaxReport, type TaxAssetRow } from '$lib/server/investment-tax';
import {
	buildCashFlows,
	compareToCdi,
	twrSeries,
	valuationSeries,
	xirr
} from '$lib/server/investment-returns';
import { loadCdiRates } from '$lib/server/investment-cdi';
import type { AssetClass, TaxBucket } from '$lib/server/investment-assets';

const CLASS_LABELS: Record<AssetClass, string> = {
	etf: 'ETFs',
	fii: 'FIIs',
	acao: 'Ações',
	fundo: 'Fundos',
	tesouro: 'Tesouro Direto',
	cdb: 'CDB/RDB',
	lca_lci: 'LCA/LCI',
	outro: 'Outros'
};

interface AssetRow {
	id: string;
	owner_user_id: string;
	asset_class: AssetClass;
	ticker: string | null;
	name: string;
	product_key: string;
	tax_bucket: TaxBucket;
	override_quantity: number | null;
	override_total_cost: number | null;
	override_date: string | null;
}

// Performance has two halves that answer different questions: a single
// money-weighted rate covering the whole history (the only thing computable
// from B3's one snapshot), and a time-weighted curve that starts the day the
// quotes cron began recording prices.
async function buildPerformance(
	assets: AssetRow[],
	events: EventRow[],
	positions: { assetId: string; value: number }[],
	quotes: QuoteRow[],
	snapshots: SnapshotRow[],
	today: string
) {
	const valueByAsset = new Map(positions.map((p) => [p.assetId, p.value]));
	const { flows, excludedAssetIds } = buildCashFlows(
		assets,
		events,
		valueByAsset,
		today
	);
	const first = flows.reduce<string | null>(
		(earliest, flow) =>
			!earliest || flow.date < earliest ? flow.date : earliest,
		null
	);
	const rate = xirr(flows);
	const rates = first ? await loadCdiRates(first, today) : [];
	const sinceInception =
		rate !== null && first ? compareToCdi(rate, rates, first, today) : null;

	// Only dates the cron actually priced can anchor a valuation.
	const quoteDates = [
		...new Set(
			quotes.filter((q) => q.source !== 'snapshot').map((q) => q.quote_date)
		)
	];
	const curve =
		quoteDates.length >= 2
			? twrSeries(
					valuationSeries(
						assets.map((asset) => asset.id),
						snapshots,
						events,
						quotes,
						quoteDates
					),
					rates
				)
			: [];

	const excludedLabels = assets
		.filter((asset) => excludedAssetIds.includes(asset.id))
		.map((asset) => asset.ticker ?? asset.name);
	const totalValue = positions.reduce((sum, p) => sum + p.value, 0);
	const coveredValue = positions
		.filter((p) => !excludedAssetIds.includes(p.assetId))
		.reduce((sum, p) => sum + p.value, 0);

	return {
		sinceInception,
		curve,
		excludedLabels,
		coveragePercent: totalValue > 0 ? (coveredValue / totalValue) * 100 : 0
	};
}

export const load: PageServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const empty = {
		positions: [],
		evolution: [],
		income: [],
		performance: {
			sinceInception: null,
			curve: [],
			excludedLabels: [],
			coveragePercent: 0
		},
		owners: [],
		currentUserId: '',
		lastSnapshotDate: null,
		unknownEventTypes: []
	};
	const { user } = await safeGetSession();
	if (!user) return empty;

	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return empty;

	const [assetsRes, snapshotsRes, eventsRes, quotesRes] = await Promise.all([
		supabase
			.from('investment_assets')
			.select(
				'id, owner_user_id, asset_class, ticker, name, product_key, tax_bucket, override_quantity, override_total_cost, override_date'
			)
			.eq('household_id', householdId),
		supabase
			.from('investment_snapshots')
			.select('asset_id, snapshot_date, quantity, close_price, net_value')
			.eq('household_id', householdId),
		supabase
			.from('investment_events')
			.select(
				'asset_id, event_date, event_type, direction, quantity, unit_price, total_value, source'
			)
			.eq('household_id', householdId),
		supabase
			.from('investment_quotes')
			.select('asset_id, quote_date, price, source')
			.eq('household_id', householdId)
	]);

	const assets = (assetsRes.data ?? []) as AssetRow[];
	const snapshots = (snapshotsRes.data ?? []) as SnapshotRow[];
	const events = (eventsRes.data ?? []) as EventRow[];
	const quotes = (quotesRes.data ?? []) as QuoteRow[];

	const today = new Date().toISOString().slice(0, 10);
	const taxReport = computeTaxReport(assets as TaxAssetRow[], events);
	const averageCostByAsset = new Map(
		taxReport.costs.map((cost) => [cost.assetId, cost.averageCost])
	);

	const unknownTypes = new Set<string>();
	const positions = assets
		.map((asset) => {
			const derived = deriveQuantity(asset.id, snapshots, events);
			for (const unknownType of derived.unknownEventTypes)
				unknownTypes.add(unknownType);
			const price = latestPrice(asset.id, quotes, snapshots);
			const value = price ? derived.quantity * price.price : 0;
			return {
				assetId: asset.id,
				ownerUserId: asset.owner_user_id,
				label: asset.ticker ?? asset.name,
				name: asset.name,
				assetClass: asset.asset_class,
				classLabel: CLASS_LABELS[asset.asset_class],
				quantity: derived.quantity,
				price: price?.price ?? null,
				priceDate: price?.date ?? null,
				value,
				averageCost: averageCostByAsset.get(asset.id) ?? null
			};
		})
		.filter((position) => position.quantity > 0)
		.sort((a, b) => b.value - a.value);

	// Passive income by month, with maturity payouts kept apart from the
	// recurring series (see monthlyPassiveIncome).
	const income = monthlyPassiveIncome(events).slice(-12);

	const lastSnapshotDate = snapshots.reduce<string | null>(
		(latest, snapshot) =>
			!latest || snapshot.snapshot_date > latest
				? snapshot.snapshot_date
				: latest,
		null
	);

	const performance = await buildPerformance(
		assets,
		events,
		positions,
		quotes,
		snapshots,
		today
	);

	return {
		positions,
		evolution: evolutionSeries(snapshots, events, quotes, today),
		income,
		performance,
		owners: [...new Set(assets.map((asset) => asset.owner_user_id))],
		currentUserId: user.id,
		lastSnapshotDate,
		unknownEventTypes: [...unknownTypes]
	};
};
