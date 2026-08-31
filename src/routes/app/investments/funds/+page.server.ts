import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	fetchCvmQuotes,
	fundKey,
	informeMonths,
	onlyDigits,
	formatCnpj
} from '$lib/server/investment-funds';

// Funds are registered by hand because they never reach B3 custody. The form
// asks for what a broker statement actually shows — balance and accumulated
// gain — and derives the rest: quotas come from dividing the balance by the
// CVM quota of the day, and the cost basis is balance minus gain.

interface FundRow {
	id: string;
	name: string;
	cnpj: string;
	cvm_subclass_id: string | null;
	asset_class: string;
	override_quantity: number | null;
	override_total_cost: number | null;
	override_date: string | null;
}

export const load: PageServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) return { funds: [] };
	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return { funds: [] };

	const { data } = await supabase
		.from('investment_assets')
		.select(
			'id, name, cnpj, cvm_subclass_id, asset_class, override_quantity, override_total_cost, override_date'
		)
		.eq('household_id', householdId)
		.not('cnpj', 'is', null)
		.order('name');

	const funds = (data ?? []) as FundRow[];
	const assetIds = funds.map((fund) => fund.id);
	const latest = new Map<string, { date: string; price: number }>();
	if (assetIds.length > 0) {
		const { data: quotes } = await supabase
			.from('investment_quotes')
			.select('asset_id, quote_date, price')
			.in('asset_id', assetIds)
			.order('quote_date', { ascending: false });
		for (const quote of quotes ?? []) {
			if (!latest.has(quote.asset_id)) {
				latest.set(quote.asset_id, {
					date: quote.quote_date as string,
					price: Number(quote.price)
				});
			}
		}
	}

	return {
		funds: funds.map((fund) => {
			const quote = latest.get(fund.id);
			const quantity = fund.override_quantity ?? 0;
			return {
				id: fund.id,
				name: fund.name,
				cnpj: formatCnpj(fund.cnpj),
				subclass: fund.cvm_subclass_id ?? '',
				assetClass: fund.asset_class,
				quantity,
				invested: fund.override_total_cost,
				investedDate: fund.override_date,
				quota: quote?.price ?? null,
				quotaDate: quote?.date ?? null,
				value: quote ? quantity * quote.price : null
			};
		})
	};
};

function parseMoney(raw: FormDataEntryValue | null): number | null {
	if (raw === null) return null;
	const value = Number(String(raw).replace(/\./g, '').replace(',', '.'));
	return Number.isFinite(value) ? value : null;
}

function text(formData: FormData, key: string): string {
	return (formData.get(key)?.toString() ?? '').trim();
}

interface FundForm {
	cnpj: string;
	subclass: string;
	name: string;
	assetClass: string;
	balance: number;
	gain: number;
	balanceDate: string | null;
	startDate: string | null;
}

function readFundForm(formData: FormData): FundForm {
	return {
		cnpj: onlyDigits(text(formData, 'cnpj')),
		subclass: text(formData, 'subclass'),
		name: text(formData, 'name'),
		assetClass: text(formData, 'asset_class') || 'fundo',
		balance: parseMoney(formData.get('balance')) ?? NaN,
		gain: parseMoney(formData.get('gain')) ?? NaN,
		balanceDate: text(formData, 'balance_date') || null,
		startDate: text(formData, 'start_date') || null
	};
}

function validateFundForm(form: FundForm): string | null {
	if (form.cnpj.length !== 14) return 'CNPJ inválido (precisa ter 14 dígitos).';
	if (!form.name) return 'Informe o nome do fundo.';
	if (!Number.isFinite(form.balance) || form.balance <= 0)
		return 'Informe o saldo atual.';
	if (!Number.isFinite(form.gain)) return 'Informe o rendimento acumulado.';
	return null;
}

async function persistFund(
	householdId: string,
	userId: string,
	form: FundForm,
	quote: { date: string; quota: number }
): Promise<string | null> {
	const quantity = form.balance / quote.quota;
	const invested = form.balance - form.gain;

	const { data: asset, error: assetError } = await supabaseAdmin
		.from('investment_assets')
		.upsert(
			{
				household_id: householdId,
				owner_user_id: userId,
				asset_class: form.assetClass,
				name: form.name,
				product_key: `CNPJ:${form.cnpj}${form.subclass ? `:${form.subclass}` : ''}`,
				cnpj: form.cnpj,
				cvm_subclass_id: form.subclass || null,
				// Funds and previdência are taxed at source (come-cotas or the
				// regressive table), so they never enter the DARF apuração.
				tax_bucket: 'retido_fonte',
				override_quantity: quantity,
				override_total_cost: invested,
				override_date: form.startDate
			},
			{ onConflict: 'household_id,owner_user_id,product_key' }
		)
		.select('id')
		.single();
	if (assetError || !asset)
		return assetError?.message ?? 'Falha ao salvar o fundo.';

	const [{ error: quoteError }, { error: snapshotError }] = await Promise.all([
		supabaseAdmin.from('investment_quotes').upsert(
			{
				household_id: householdId,
				asset_id: asset.id,
				quote_date: quote.date,
				price: quote.quota,
				source: 'cvm'
			},
			{ onConflict: 'asset_id,quote_date' }
		),
		supabaseAdmin.from('investment_snapshots').upsert(
			{
				household_id: householdId,
				asset_id: asset.id,
				snapshot_date: form.balanceDate ?? quote.date,
				quantity,
				close_price: quote.quota,
				net_value: form.balance,
				applied_value: invested
			},
			{ onConflict: 'household_id,asset_id,snapshot_date' }
		)
	]);
	return quoteError?.message ?? snapshotError?.message ?? null;
}

export const actions: Actions = {
	add: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId)
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});

		const form = readFundForm(await request.formData());
		const invalid = validateFundForm(form);
		if (invalid) return fail(400, { success: false, message: invalid });

		// The quota that turns the balance into a number of quotas: preferably
		// the one from the balance's own date, else the freshest published.
		const reference = form.balanceDate
			? new Date(`${form.balanceDate}T00:00:00Z`)
			: new Date();
		const { quotes, errors } = await fetchCvmQuotes(
			new Set([fundKey(form.cnpj, form.subclass)]),
			informeMonths(reference, 3)
		);
		const quote = quotes.get(fundKey(form.cnpj, form.subclass));
		if (!quote) {
			const detail = errors.length > 0 ? ` Detalhe: ${errors.join(', ')}` : '';
			const sub = form.subclass ? ` (subclasse ${form.subclass})` : '';
			return fail(400, {
				success: false,
				message: `A CVM não publica cota para ${formatCnpj(form.cnpj)}${sub}. Confira o CNPJ e a subclasse.${detail}`
			});
		}

		const error = await persistFund(householdId, user.id, form, quote);
		if (error) return fail(500, { success: false, message: error });

		const cotas = (form.balance / quote.quota).toLocaleString('pt-BR', {
			maximumFractionDigits: 2
		});
		return {
			success: true,
			message: `${form.name}: ${cotas} cotas pela cota de ${quote.date} (${quote.quota}).`
		};
	},

	remove: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId)
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});

		const assetId = (await request.formData()).get('asset_id')?.toString();
		if (!assetId)
			return fail(400, { success: false, message: 'Fundo não informado' });
		const { error } = await supabaseAdmin
			.from('investment_assets')
			.delete()
			.eq('id', assetId)
			.eq('household_id', householdId)
			.eq('owner_user_id', user.id);
		if (error) return fail(500, { success: false, message: error.message });
		return { success: true, message: 'Fundo removido.' };
	}
};
