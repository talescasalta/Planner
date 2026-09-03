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
import { monthlyPassiveIncome } from '$lib/server/investment-positions';
import {
	loadInvestmentRows,
	valuePositions,
	type InvestmentRows
} from '$lib/server/investment-overview';
import type { TaxAssetRow } from '$lib/server/investment-tax';

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
	rows: InvestmentRows,
	positions: { assetId: string; value: number }[],
	today: string
) {
	const { assets, events, quotes, snapshots } = rows;
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

	const rows = await loadInvestmentRows(supabase, householdId);
	const { assets, snapshots, events, quotes } = rows;
	if (assets.length === 0) return { ...empty, currentUserId: user.id };

	const today = new Date().toISOString().slice(0, 10);
	const months = recentMonths(today, HOW_MANY_MONTHS);
	const oldest = `${months.at(-1)}-01`;
	const rates = await loadCdiRates(oldest, today);

	const positions = valuePositions(rows).filter(
		(position) => position.value > 0
	);

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
		performance: await buildPerformance(rows, positions, today),
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
