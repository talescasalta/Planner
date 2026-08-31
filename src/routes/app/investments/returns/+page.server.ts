import type { PageServerLoad } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import { loadCdiRates } from '$lib/server/investment-cdi';
import {
	appliedSeries,
	monthReturn,
	recentMonths,
	type AppliedSeries,
	type MonthReturn
} from '$lib/server/investment-monthly';
import type { TaxAssetRow } from '$lib/server/investment-tax';
import type {
	EventRow,
	QuoteRow,
	SnapshotRow
} from '$lib/server/investment-positions';

interface AssetRow {
	id: string;
	owner_user_id: string;
	ticker: string | null;
	name: string;
	asset_class: string;
}

const HOW_MANY_MONTHS = 6;

interface AssetLabel {
	label: string;
	owner: string;
	assetClass: string;
}

export const load: PageServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const empty = {
		applied: {
			points: [],
			excludedCount: 0,
			excludedValue: 0
		} as AppliedSeries,
		months: [] as (MonthReturn & { assets: MonthReturn['assets'] })[],
		labels: {} as Record<string, AssetLabel>,
		currentUserId: '',
		owners: [] as string[]
	};
	const { user } = await safeGetSession();
	if (!user) return empty;
	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return empty;

	const [assetsRes, snapshotsRes, eventsRes, quotesRes] = await Promise.all([
		supabase
			.from('investment_assets')
			.select('id, owner_user_id, ticker, name, asset_class')
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
	if (assets.length === 0) return { ...empty, currentUserId: user.id };

	const today = new Date().toISOString().slice(0, 10);
	const months = recentMonths(today, HOW_MANY_MONTHS);
	const oldest = `${months.at(-1)}-01`;
	const rates = await loadCdiRates(oldest, today);

	const assetIds = assets.map((asset) => asset.id);
	const computed: MonthReturn[] = months.map((month) =>
		monthReturn(assetIds, month, today, snapshots, events, quotes, rates)
	);

	const labels: Record<string, AssetLabel> = {};
	for (const asset of assets) {
		labels[asset.id] = {
			label: asset.ticker ?? asset.name,
			owner: asset.owner_user_id,
			assetClass: asset.asset_class
		};
	}

	return {
		applied: appliedSeries(
			assets as unknown as TaxAssetRow[],
			events,
			snapshots,
			quotes,
			// A full year of the pair reads better than the six months the
			// month picker offers.
			recentMonths(today, 12),
			today
		),
		months: computed.map((month) => ({
			...month,
			// Only assets that actually held a position are worth listing.
			assets: month.assets.filter(
				(asset) => asset.startQuantity > 0 || asset.endQuantity > 0
			)
		})),
		labels,
		currentUserId: user.id,
		owners: [...new Set(assets.map((asset) => asset.owner_user_id))]
	};
};
