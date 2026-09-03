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
import {
	extractFundsFromImage,
	extractFundsFromText
} from '$lib/server/investment-fund-extract';
import {
	detectImageMimeType,
	isPdf,
	extractTextFromPdf
} from '$lib/server/import-extract';
import { searchFunds } from '$lib/server/investment-registry';
import { checkPersistentRateLimit } from '$lib/server/rate-limit';
import {
	LLM_RATE_LIMIT,
	LLM_RATE_LIMIT_MESSAGE,
	UPLOAD_TOO_LARGE_MESSAGE,
	isIsoDate,
	uploadTooLarge
} from '$lib/server/request-guards';

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
		// Newest first, and only the first row per fund is kept — so the
		// thousand-row cap PostgREST applies drops history we do not want
		// anyway. See supabase-paging for reads where that cap does bite.
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

function text(formData: FormData, key: string, max = 200): string {
	return (formData.get(key)?.toString() ?? '').trim().slice(0, max);
}

const FUND_CLASSES = new Set(['fundo', 'previdencia']);

// null = not sent; undefined = sent but not a valid YYYY-MM-DD.
function optionalDate(value: string): string | null | undefined {
	if (!value) return null;
	return isIsoDate(value) ? value : undefined;
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

// Raw form values before validation: dates may still be malformed.
type FundFormInput = Omit<FundForm, 'balanceDate' | 'startDate'> & {
	balanceDate: string | null | undefined;
	startDate: string | null | undefined;
};

function readFundForm(formData: FormData): FundFormInput {
	return {
		cnpj: onlyDigits(text(formData, 'cnpj', 32)),
		subclass: text(formData, 'subclass', 16),
		name: text(formData, 'name'),
		assetClass: text(formData, 'asset_class', 32) || 'fundo',
		balance: parseMoney(formData.get('balance')) ?? NaN,
		gain: parseMoney(formData.get('gain')) ?? NaN,
		balanceDate: optionalDate(text(formData, 'balance_date', 10)),
		startDate: optionalDate(text(formData, 'start_date', 10))
	};
}

function validateFundForm(
	form: FundFormInput
): { ok: true; form: FundForm } | { ok: false; message: string } {
	if (form.cnpj.length !== 14)
		return { ok: false, message: 'CNPJ inválido (precisa ter 14 dígitos).' };
	if (form.subclass && !/^[A-Za-z0-9]+$/.test(form.subclass))
		return { ok: false, message: 'Subclasse inválida.' };
	if (!form.name) return { ok: false, message: 'Informe o nome do fundo.' };
	if (!FUND_CLASSES.has(form.assetClass))
		return { ok: false, message: 'Tipo de fundo inválido.' };
	if (!Number.isFinite(form.balance) || form.balance <= 0)
		return { ok: false, message: 'Informe o saldo atual.' };
	if (!Number.isFinite(form.gain))
		return { ok: false, message: 'Informe o rendimento acumulado.' };
	if (form.balanceDate === undefined || form.startDate === undefined)
		return { ok: false, message: 'Data inválida (use AAAA-MM-DD).' };
	return {
		ok: true,
		form: { ...form, balanceDate: form.balanceDate, startDate: form.startDate }
	};
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
	if (assetError || !asset) {
		console.error('[investments/funds] asset upsert failed', assetError);
		return 'Falha ao salvar o fundo.';
	}

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
	if (quoteError || snapshotError) {
		console.error('[investments/funds] quote/snapshot upsert failed', {
			quoteError,
			snapshotError
		});
		return 'Falha ao salvar a cota do fundo.';
	}
	return null;
}

// Reads a broker screen and hands the numbers back for the user to review in
// the form. Nothing is written here: extraction is a suggestion, and the CNPJ
// still has to come from the registry rather than from the model.
async function readFundScreenshot(file: File) {
	const buffer = Buffer.from(await file.arrayBuffer());
	if (isPdf(buffer)) {
		const extracted = await extractTextFromPdf(buffer);
		if (!extracted || extracted.text.length < 100) {
			return {
				message:
					'O PDF não tem texto selecionável (provavelmente digitalizado). Envie um print da tela.'
			};
		}
		return { extraction: await extractFundsFromText(extracted.text) };
	}
	const mimeType = detectImageMimeType(buffer);
	if (!mimeType) {
		return {
			message: 'Envie um print em PNG, JPEG ou WebP, ou um PDF com texto.'
		};
	}
	return { extraction: await extractFundsFromImage(buffer, mimeType) };
}

export const actions: Actions = {
	read_screenshot: async ({
		request,
		locals: { supabase, safeGetSession }
	}) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId)
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});

		const file = (await request.formData()).get('screenshot') as File | null;
		if (!file || file.size === 0) {
			return fail(400, { success: false, message: 'Envie um print ou PDF.' });
		}
		if (uploadTooLarge(file)) {
			return fail(400, { success: false, message: UPLOAD_TOO_LARGE_MESSAGE });
		}

		// This action spends an LLM call per upload; it shares the per-user
		// budget of every other LLM entry point.
		if (
			!(await checkPersistentRateLimit(supabaseAdmin, user.id, LLM_RATE_LIMIT))
		) {
			return fail(429, { success: false, message: LLM_RATE_LIMIT_MESSAGE });
		}

		let result;
		try {
			result = await readFundScreenshot(file);
		} catch (error) {
			console.error('[investments/funds] screenshot extraction failed', error);
			return fail(500, {
				success: false,
				message: 'Falha ao ler a imagem. Tente de novo em instantes.'
			});
		}
		if ('message' in result)
			return fail(400, { success: false, message: result.message });

		const { extraction } = result;
		if (extraction.funds.length === 0) {
			return fail(400, {
				success: false,
				message:
					extraction.notes ??
					'Não identifiquei nenhuma posição de fundo nesta imagem.'
			});
		}

		// Each extracted fund is matched against the registry so the form can
		// offer real CNPJs to pick from.
		const found = await Promise.all(
			extraction.funds.map(async (fund) => ({
				...fund,
				candidates: fund.cnpj ? [] : await searchFunds(fund.name)
			}))
		);

		return {
			success: true,
			extracted: found,
			confidence: extraction.confidence,
			notes: extraction.notes ?? null
		};
	},

	add: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });
		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId)
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});

		const validated = validateFundForm(readFundForm(await request.formData()));
		if (!validated.ok)
			return fail(400, { success: false, message: validated.message });
		const form = validated.form;

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
		if (error) {
			console.error('[investments/funds] delete failed', error);
			return fail(500, {
				success: false,
				message: 'Falha ao remover o fundo.'
			});
		}
		return { success: true, message: 'Fundo removido.' };
	}
};
