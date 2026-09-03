import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import { monthlyPassiveIncome } from '$lib/server/investment-positions';
import {
	lastSnapshotDate,
	loadInvestmentRows,
	valuePositions
} from '$lib/server/investment-overview';
import { computeTaxReport, type TaxAssetRow } from '$lib/server/investment-tax';
import { isAccruable } from '$lib/server/investment-accrual';
import { parseRate } from '$lib/server/request-guards';
import { supabaseAdmin } from '$lib/server/supabase';
import { classLabel } from '$lib/investments/classes';

// Bank-issued paper has no public quote: without a declared carry rate it can
// only be carried at the last B3 value, which freezes it out of every measured
// period. So the page asks for the rate for as long as one is missing.
const CARRY_RATE_CLASSES = new Set(['cdb', 'lca_lci']);

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
			const carry = {
				indexType: asset.index_type,
				percent: asset.index_percent,
				spread: asset.index_spread
			};
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
				averageCost: averageCostByAsset.get(asset.id) ?? null,
				maturityDate: asset.maturity_date,
				indexType: asset.index_type,
				indexPercent: asset.index_percent,
				indexSpread: asset.index_spread,
				// Only bank-issued paper needs one; everything else is quoted.
				needsCarryRate:
					CARRY_RATE_CLASSES.has(asset.asset_class) &&
					!isAccruable({
						indexType: carry.indexType ?? '',
						percent: carry.percent,
						spread: carry.spread
					})
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

const INDEX_TYPES = new Set(['cdi', 'pre']);

interface CarryRateForm {
	assetId: string;
	indexType: string;
	percent: number;
	spread: number | null;
}

function parseNumber(raw: FormDataEntryValue | null): number | null {
	return raw === null ? null : parseRate(String(raw));
}

function readPercent(
	raw: FormDataEntryValue | null,
	indexType: string
): number | { message: string } {
	const percent = parseNumber(raw);
	if (percent !== null && percent > 0 && percent <= 1000) return percent;
	return {
		message:
			indexType === 'cdi'
				? 'Informe o percentual do CDI (ex.: 96).'
				: 'Informe a taxa anual (ex.: 12).'
	};
}

function readSpread(
	raw: FormDataEntryValue | null
): number | null | { message: string } {
	const spread = parseNumber(raw);
	if (spread === null) return null;
	if (spread >= 0 && spread <= 100) return spread;
	return { message: 'Spread inválido.' };
}

function readCarryRateForm(
	formData: FormData
): CarryRateForm | { message: string } {
	const assetId = formData.get('asset_id')?.toString() ?? '';
	if (!assetId) return { message: 'Ativo não informado.' };
	const indexType = formData.get('index_type')?.toString() ?? '';
	if (!INDEX_TYPES.has(indexType)) {
		return { message: 'Escolha CDI ou prefixado.' };
	}
	const percent = readPercent(formData.get('index_percent'), indexType);
	if (typeof percent !== 'number') return percent;
	const spread = readSpread(formData.get('index_spread'));
	if (typeof spread === 'object' && spread !== null) return spread;
	return { assetId, indexType, percent, spread };
}

export const actions: Actions = {
	set_carry_rate: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});
		}

		const parsed = readCarryRateForm(await request.formData());
		if ('message' in parsed) {
			return fail(400, { success: false, message: parsed.message });
		}

		const { error } = await supabaseAdmin
			.from('investment_assets')
			.update({
				index_type: parsed.indexType,
				index_percent: parsed.percent,
				index_spread: parsed.spread
			})
			.eq('id', parsed.assetId)
			.eq('household_id', householdId)
			.eq('owner_user_id', user.id);
		if (error) {
			console.error('[investments] carry rate update failed', error);
			return fail(500, { success: false, message: 'Falha ao salvar a taxa.' });
		}
		return {
			success: true,
			message:
				'Taxa salva. O preço passa a ser atualizado na curva a cada dia útil.'
		};
	}
};
