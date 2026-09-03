import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { computeTaxReport, type TaxAssetRow } from '$lib/server/investment-tax';
import type { EventRow } from '$lib/server/investment-positions';
import { isIsoDate, isIsoMonth } from '$lib/server/request-guards';

// IR é apurado por CPF: cada usuário vê e calcula apenas a própria apuração
// (ativos cujo owner_user_id é o seu), ainda que o household compartilhe a
// visão de patrimônio.

interface OwnedAsset extends TaxAssetRow {
	owner_user_id: string;
	product_key: string;
	ticker: string | null;
	name: string;
}

export const load: PageServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const empty = {
		months: [],
		costs: [],
		assets: [],
		darfStatus: [],
		carryforward: null
	};
	const { user } = await safeGetSession();
	if (!user) return empty;
	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return empty;

	const { data: assetRows } = await supabase
		.from('investment_assets')
		.select(
			'id, owner_user_id, product_key, ticker, name, tax_bucket, override_quantity, override_total_cost, override_date'
		)
		.eq('household_id', householdId)
		.eq('owner_user_id', user.id);
	const assets = (assetRows ?? []) as OwnedAsset[];
	if (assets.length === 0) return empty;

	const assetIds = assets.map((asset) => asset.id);
	const [{ data: eventRows }, { data: darfRows }] = await Promise.all([
		supabase
			.from('investment_events')
			.select(
				'asset_id, event_date, event_type, direction, quantity, unit_price, total_value, source'
			)
			.eq('household_id', householdId)
			.in('asset_id', assetIds),
		supabase
			.from('investment_darf_status')
			.select('reference_month, paid, paid_at, amount_paid')
			.eq('household_id', householdId)
			.eq('owner_user_id', user.id)
	]);

	const report = computeTaxReport(assets, (eventRows ?? []) as EventRow[]);
	const labelByAsset = new Map(
		assets.map((asset) => [asset.id, asset.ticker ?? asset.name])
	);

	return {
		months: report.months,
		carryforward: report.carryforwardLosses,
		costs: report.costs.map((cost) => ({
			...cost,
			label: labelByAsset.get(cost.assetId) ?? cost.assetId
		})),
		assets: assets.map((asset) => ({
			id: asset.id,
			label: asset.ticker ?? asset.name,
			tax_bucket: asset.tax_bucket,
			override_quantity: asset.override_quantity,
			override_total_cost: asset.override_total_cost,
			override_date: asset.override_date
		})),
		darfStatus: (darfRows ?? []).map((row) => ({
			reference_month: (row.reference_month as string).slice(0, 7),
			paid: row.paid as boolean
		}))
	};
};

interface OverrideUpdate {
	override_quantity: number | null;
	override_total_cost: number | null;
	override_date: string | null;
}

function parseOverrideValues(
	formData: FormData
): OverrideUpdate | { message: string } {
	const quantity = Number(formData.get('quantity'));
	const totalCost = Number(formData.get('total_cost'));
	if (!Number.isFinite(quantity) || !Number.isFinite(totalCost)) {
		return { message: 'Quantidade e custo total são obrigatórios' };
	}
	if (quantity < 0 || totalCost < 0) {
		return { message: 'Quantidade e custo total não podem ser negativos' };
	}
	const date = formData.get('date')?.toString().trim() || null;
	if (date && !isIsoDate(date)) {
		return { message: 'Data inválida (use AAAA-MM-DD)' };
	}
	return {
		override_quantity: quantity,
		override_total_cost: totalCost,
		override_date: date
	};
}

function parseOverrideForm(
	formData: FormData
): { assetId: string; update: OverrideUpdate } | { message: string } {
	const assetId = formData.get('asset_id')?.toString();
	if (!assetId) return { message: 'Ativo não informado' };
	if (formData.get('clear')?.toString() === 'true') {
		return {
			assetId,
			update: {
				override_quantity: null,
				override_total_cost: null,
				override_date: null
			}
		};
	}
	const values = parseOverrideValues(formData);
	if ('message' in values) return values;
	return { assetId, update: values };
}

interface DarfForm {
	month: string;
	paid: boolean;
	amount: number | null;
}

function parseDarfForm(formData: FormData): DarfForm | { message: string } {
	const month = formData.get('month')?.toString() ?? '';
	if (!isIsoMonth(month)) return { message: 'Mês inválido' };
	const paid = formData.get('paid')?.toString() === 'true';
	if (!paid) return { month, paid, amount: null };
	const rawAmount = formData.get('amount')?.toString().trim();
	if (!rawAmount) return { month, paid, amount: null };
	const amount = Number(rawAmount);
	if (!Number.isFinite(amount) || amount < 0) {
		return { message: 'Valor pago inválido' };
	}
	return { month, paid, amount };
}

export const actions: Actions = {
	mark_paid: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId)
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});

		const parsed = parseDarfForm(await request.formData());
		if ('message' in parsed)
			return fail(400, { success: false, message: parsed.message });
		const { month, paid, amount } = parsed;

		const { error } = await supabaseAdmin.from('investment_darf_status').upsert(
			{
				household_id: householdId,
				owner_user_id: user.id,
				reference_month: `${month}-01`,
				paid,
				paid_at: paid ? new Date().toISOString().slice(0, 10) : null,
				amount_paid: amount
			},
			{ onConflict: 'household_id,owner_user_id,reference_month' }
		);
		if (error) {
			console.error('[investments/taxes] darf status upsert failed', error);
			return fail(500, {
				success: false,
				message: 'Falha ao salvar o status.'
			});
		}
		return { success: true };
	},

	set_override: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId)
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});

		const parsed = parseOverrideForm(await request.formData());
		if ('message' in parsed)
			return fail(400, { success: false, message: parsed.message });

		const { error } = await supabaseAdmin
			.from('investment_assets')
			.update(parsed.update)
			.eq('id', parsed.assetId)
			.eq('household_id', householdId)
			.eq('owner_user_id', user.id);
		if (error) {
			console.error('[investments/taxes] override update failed', error);
			return fail(500, { success: false, message: 'Falha ao salvar o custo.' });
		}
		return { success: true };
	}
};
