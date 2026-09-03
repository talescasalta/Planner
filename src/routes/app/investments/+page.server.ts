import type { PageServerLoad } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import { monthlyPassiveIncome } from '$lib/server/investment-positions';
import {
	lastSnapshotDate,
	loadInvestmentRows,
	valuePositions
} from '$lib/server/investment-overview';
import { computeTaxReport, type TaxAssetRow } from '$lib/server/investment-tax';
import { classLabel } from '$lib/investments/classes';

export const load: PageServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const empty = {
		positions: [],
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

	const rows = await loadInvestmentRows(supabase, householdId);
	const assetById = new Map(rows.assets.map((asset) => [asset.id, asset]));

	const taxReport = computeTaxReport(
		rows.assets as unknown as TaxAssetRow[],
		rows.events
	);
	const averageCostByAsset = new Map(
		taxReport.costs.map((cost) => [cost.assetId, cost.averageCost])
	);

	const unknownTypes = new Set<string>();
	const positions = valuePositions(rows)
		.map((position) => {
			for (const unknownType of position.unknownEventTypes)
				unknownTypes.add(unknownType);
			const asset = assetById.get(position.assetId)!;
			return {
				assetId: asset.id,
				ownerUserId: asset.owner_user_id,
				label: asset.ticker ?? asset.name,
				name: asset.name,
				assetClass: asset.asset_class,
				classLabel: classLabel(asset.asset_class),
				quantity: position.quantity,
				price: position.price,
				priceDate: position.priceDate,
				value: position.value,
				averageCost: averageCostByAsset.get(asset.id) ?? null
			};
		})
		.filter((position) => position.quantity > 0)
		.sort((a, b) => b.value - a.value);

	return {
		positions,
		// Passive income by month, with maturity payouts kept apart from the
		// recurring series (see monthlyPassiveIncome).
		income: monthlyPassiveIncome(rows.events).slice(-12),
		owners: [...new Set(rows.assets.map((asset) => asset.owner_user_id))],
		currentUserId: user.id,
		lastSnapshotDate: lastSnapshotDate(rows.snapshots),
		unknownEventTypes: [...unknownTypes]
	};
};
