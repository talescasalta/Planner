import type { PageServerLoad } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import {
	deriveQuantity,
	evolutionSeries,
	latestPrice,
	classifyEvent,
	type EventRow,
	type QuoteRow,
	type SnapshotRow
} from '$lib/server/investment-positions';
import { computeTaxReport, type TaxAssetRow } from '$lib/server/investment-tax';
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

export const load: PageServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const empty = {
		positions: [],
		evolution: [],
		income: [],
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
			.select('asset_id, quote_date, price')
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

	// Passive income by month (Rendimento/Juros/Dividendo/JCP...), last 12.
	const incomeByMonth = new Map<string, number>();
	for (const event of events) {
		if (classifyEvent(event) !== 'income' || event.direction !== 'credit')
			continue;
		const monthKey = event.event_date.slice(0, 7);
		incomeByMonth.set(
			monthKey,
			(incomeByMonth.get(monthKey) ?? 0) + (event.total_value ?? 0)
		);
	}
	const income = [...incomeByMonth.entries()]
		.map(([month, total]) => ({ month, total }))
		.sort((a, b) => a.month.localeCompare(b.month))
		.slice(-12);

	const lastSnapshotDate = snapshots.reduce<string | null>(
		(latest, snapshot) =>
			!latest || snapshot.snapshot_date > latest
				? snapshot.snapshot_date
				: latest,
		null
	);

	return {
		positions,
		evolution: evolutionSeries(snapshots, events, quotes, today),
		income,
		owners: [...new Set(assets.map((asset) => asset.owner_user_id))],
		currentUserId: user.id,
		lastSnapshotDate,
		unknownEventTypes: [...unknownTypes]
	};
};
