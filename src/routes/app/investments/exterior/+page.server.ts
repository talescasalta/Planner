import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import { parseWiseStatement } from '$lib/server/wise-statement';
import {
	persistWiseStatement,
	saveRendeBalance,
	type RendeBalanceInput,
	unitsOn
} from '$lib/server/wise-persist';
import { extractRendeFromImage } from '$lib/server/wise-print-extract';
import { detectImageMimeType } from '$lib/server/import-extract';
import { brazilToday } from '$lib/server/brazil-date';
import { checkPersistentRateLimit } from '$lib/server/rate-limit';
import {
	LLM_RATE_LIMIT,
	LLM_RATE_LIMIT_MESSAGE,
	UPLOAD_TOO_LARGE_MESSAGE,
	isIsoDate,
	parseRate,
	uploadTooLarge
} from '$lib/server/request-guards';

// Holdings abroad — today, the Wise Rende+ balance. The statement says how
// many quotas exist and at what price they were bought; a print of the app
// says what they are worth now and at what pace they grow. Between the two,
// the quotes cron accrues the quota and converts it at PTAX.

interface ForeignAssetRow {
	id: string;
	name: string;
	isin: string | null;
	currency: string;
	index_type: string | null;
	index_percent: number | null;
}

export const load: PageServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) return { holdings: [] };
	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return { holdings: [] };

	const { data } = await supabase
		.from('investment_assets')
		.select('id, name, isin, currency, index_type, index_percent')
		.eq('household_id', householdId)
		.neq('currency', 'BRL')
		.order('name');
	const assets = (data ?? []) as ForeignAssetRow[];
	if (assets.length === 0) return { holdings: [] };
	const ids = assets.map((asset) => asset.id);

	const [{ data: events }, { data: quotes }] = await Promise.all([
		supabase
			.from('investment_events')
			.select('asset_id, event_date, direction, quantity, native_total_value')
			.in('asset_id', ids),
		// Newest first, and only the first row per asset (and the first Wise
		// anchor) are kept, so the PostgREST row cap only drops old history.
		supabase
			.from('investment_quotes')
			.select('asset_id, quote_date, price, native_price, source')
			.in('asset_id', ids)
			.order('quote_date', { ascending: false })
	]);

	const today = brazilToday();
	return {
		holdings: assets.map((asset) =>
			holdingView(
				asset,
				((events ?? []) as HoldingEvent[]).filter(
					(e) => e.asset_id === asset.id
				),
				((quotes ?? []) as HoldingQuote[]).filter(
					(q) => q.asset_id === asset.id
				),
				today
			)
		)
	};
};

interface HoldingEvent {
	asset_id: string;
	event_date: string;
	direction: string;
	quantity: number | null;
	native_total_value: number | null;
}

interface HoldingQuote {
	asset_id: string;
	quote_date: string;
	price: number;
	native_price: number | null;
	source: string;
}

// Net amount put in, in the holding's own currency.
function nativeInvested(events: HoldingEvent[]): number {
	return events.reduce((sum, e) => {
		const value = Number(e.native_total_value ?? 0);
		return sum + (e.direction === 'credit' ? value : -value);
	}, 0);
}

// One holding as the table shows it. Quotes arrive newest first.
function holdingView(
	asset: ForeignAssetRow,
	events: HoldingEvent[],
	quotes: HoldingQuote[],
	today: string
) {
	const units = unitsOn(events, today);
	const latest = latestPricing(quotes.at(0));
	return {
		id: asset.id,
		name: asset.name,
		isin: asset.isin,
		currency: asset.currency,
		ratePercent: asset.index_type === 'pre' ? asset.index_percent : null,
		units,
		nativeInvested: nativeInvested(events),
		...latest,
		nativeValue:
			latest.nativePrice === null ? null : units * latest.nativePrice,
		value: latest.price === null ? null : units * latest.price,
		anchorDate: quotes.find((q) => q.source === 'wise')?.quote_date ?? null
	};
}

// The newest quote in both currencies, and the PTAX implied between them.
function latestPricing(quote: HoldingQuote | undefined) {
	if (!quote)
		return { nativePrice: null, price: null, fx: null, priceDate: null };
	const price = Number(quote.price);
	const nativePrice =
		quote.native_price === null ? null : Number(quote.native_price);
	return {
		nativePrice,
		price,
		fx: nativePrice ? price / nativePrice : null,
		priceDate: quote.quote_date
	};
}

async function requireHousehold(
	supabase: App.Locals['supabase'],
	safeGetSession: App.Locals['safeGetSession']
) {
	const { user } = await safeGetSession();
	if (!user)
		return { error: fail(401, { success: false, message: 'Não autenticado' }) };
	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId)
		return {
			error: fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			})
		};
	return { userId: user.id, householdId };
}

function parseMoney(text: string): number | null {
	if (!text) return null;
	// Accepts both "27247.71" (from the reader) and "27.247,71" (typed).
	const normalized = text.includes(',')
		? text.replace(/\./g, '').replace(',', '.')
		: text;
	const value = Number(normalized);
	return Number.isFinite(value) ? value : null;
}

function field(formData: FormData, key: string): string {
	return (formData.get(key)?.toString() ?? '').trim();
}

// The rate is optional: without it the quota stays at the last declared pace.
function readRate(raw: string): number | null | { message: string } {
	if (!raw) return null;
	const rate = parseRate(raw);
	return rate !== null && rate > 0 && rate < 100
		? rate
		: { message: 'Taxa inválida (ex.: 3,61).' };
}

function readBalanceForm(
	formData: FormData
): RendeBalanceInput | { message: string } {
	const assetId = field(formData, 'asset_id');
	const balance = parseMoney(field(formData, 'balance'));
	const ratePercent = readRate(field(formData, 'rate'));
	const date = field(formData, 'date');
	if (!assetId) return { message: 'Escolha o saldo.' };
	if (balance === null || balance <= 0) return { message: 'Informe o saldo.' };
	if (typeof ratePercent === 'object' && ratePercent !== null)
		return ratePercent;
	if (!isIsoDate(date) || date > brazilToday())
		return { message: 'Data inválida.' };
	return { assetId, balance, ratePercent, date };
}

export const actions: Actions = {
	import_statement: async ({
		request,
		locals: { supabase, safeGetSession }
	}) => {
		const auth = await requireHousehold(supabase, safeGetSession);
		if ('error' in auth) return auth.error;

		const file = (await request.formData()).get('statement');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { success: false, message: 'Envie o extrato da Wise.' });
		if (uploadTooLarge(file))
			return fail(400, { success: false, message: UPLOAD_TOO_LARGE_MESSAGE });

		let statement;
		try {
			statement = parseWiseStatement(new Uint8Array(await file.arrayBuffer()));
		} catch (error) {
			return fail(400, {
				success: false,
				message: String((error as Error).message)
			});
		}

		const result = await persistWiseStatement(
			auth.householdId,
			auth.userId,
			statement,
			file.name
		);
		if (result.errorMessage)
			return fail(400, { success: false, message: result.errorMessage });

		const parts = [
			`${result.inserted} movimento(s) do Rende+ importado(s)`,
			result.skippedDuplicates > 0
				? `${result.skippedDuplicates} já estavam no app`
				: null,
			...statement.warnings
		].filter(Boolean);
		return { success: true, message: `${parts.join('. ')}.` };
	},

	read_print: async ({ request, locals: { supabase, safeGetSession } }) => {
		const auth = await requireHousehold(supabase, safeGetSession);
		if ('error' in auth) return auth.error;

		const file = (await request.formData()).get('print');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, {
				success: false,
				message: 'Envie um print do Rende+.'
			});
		if (uploadTooLarge(file))
			return fail(400, { success: false, message: UPLOAD_TOO_LARGE_MESSAGE });
		const buffer = Buffer.from(await file.arrayBuffer());
		const mimeType = detectImageMimeType(buffer);
		if (!mimeType)
			return fail(400, {
				success: false,
				message: 'Envie um print em PNG, JPEG ou WebP.'
			});

		// One LLM call per upload, on the same per-user budget as the others.
		if (
			!(await checkPersistentRateLimit(
				supabaseAdmin,
				auth.userId,
				LLM_RATE_LIMIT
			))
		)
			return fail(429, { success: false, message: LLM_RATE_LIMIT_MESSAGE });

		let extraction;
		try {
			extraction = await extractRendeFromImage(buffer, mimeType);
		} catch (error) {
			console.error('[investments/exterior] print extraction failed', error);
			return fail(500, {
				success: false,
				message: 'Falha ao ler a imagem. Tente de novo em instantes.'
			});
		}
		if (extraction.balances.length === 0 || extraction.confidence < 0.6) {
			return fail(400, {
				success: false,
				message:
					extraction.notes ?? 'Não identifiquei saldos do Rende+ nesta imagem.'
			});
		}
		return {
			success: true,
			read: true,
			balances: extraction.balances,
			notes: extraction.notes ?? null,
			today: brazilToday()
		};
	},

	save_balance: async ({ request, locals: { supabase, safeGetSession } }) => {
		const auth = await requireHousehold(supabase, safeGetSession);
		if ('error' in auth) return auth.error;

		const input = readBalanceForm(await request.formData());
		if ('message' in input)
			return fail(400, { success: false, message: input.message });

		const result = await saveRendeBalance(auth.householdId, auth.userId, input);
		if ('errorMessage' in result)
			return fail(400, { success: false, message: result.errorMessage });
		return {
			success: true,
			message: `Saldo atualizado: cota de ${result.nativePrice.toFixed(4)} em ${input.date}.`
		};
	}
};
