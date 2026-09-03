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
import {
	buildCashFlows,
	compareToCdi,
	twrSeries,
	valuationSeries,
	xirr
} from '$lib/server/investment-returns';
import {
	deriveQuantity,
	latestPrice,
	monthlyPassiveIncome
} from '$lib/server/investment-positions';
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
	override_quantity: number | null;
	override_total_cost: number | null;
	override_date: string | null;
}

const HOW_MANY_MONTHS = 6;

interface AssetLabel {
	label: string;
	owner: string;
	assetClass: string;
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
		performance: {
			sinceInception: null,
			curve: [] as { date: string; portfolioIndex: number; cdiIndex: number }[],
			excludedLabels: [] as string[],
			coveragePercent: 0
		},
		income: [] as { month: string; recurring: number; maturity: number }[],
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
			.select(
				'id, owner_user_id, ticker, name, asset_class, override_quantity, override_total_cost, override_date'
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
	if (assets.length === 0) return { ...empty, currentUserId: user.id };

	const today = new Date().toISOString().slice(0, 10);
	const months = recentMonths(today, HOW_MANY_MONTHS);
	const oldest = `${months.at(-1)}-01`;
	const rates = await loadCdiRates(oldest, today);

	const positions = assets
		.map((asset) => {
			const quantity = deriveQuantity(asset.id, snapshots, events).quantity;
			const price = latestPrice(asset.id, quotes, snapshots);
			return { assetId: asset.id, value: price ? quantity * price.price : 0 };
		})
		.filter((position) => position.value > 0);

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
		performance: await buildPerformance(
			assets,
			events,
			positions,
			quotes,
			snapshots,
			today
		),
		// Passive income by month, with maturity payouts kept apart from the
		// recurring series (see monthlyPassiveIncome).
		income: monthlyPassiveIncome(events).slice(-12),
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
