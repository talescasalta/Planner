import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import {
	parseB3File,
	snapshotDateFromFilename,
	type ParsedB3File
} from '$lib/server/investment-import';
import { persistParsedB3File } from '$lib/server/investment-import-persist';

// Mirrors app/imports: preview and confirm each re-parse the uploaded File
// (re-sent by the page on confirm), so nothing is staged server-side. B3
// exports are small (hundreds of rows), the double parse costs milliseconds.

const KIND_LABELS: Record<ParsedB3File['kind'], string> = {
	posicao: 'Posição (snapshot do patrimônio)',
	negociacao: 'Negociação (compras e vendas)',
	movimentacao: 'Movimentação (proventos e eventos)'
};

async function resolveUpload(formData: FormData) {
	const file = formData.get('file') as File | null;
	if (!file || file.size === 0) return null;
	const buffer = Buffer.from(await file.arrayBuffer());
	const parsed = await parseB3File(buffer);
	return { parsed, filename: file.name };
}

function readSnapshotDate(formData: FormData, filename: string): string | null {
	const manual = formData.get('snapshot_date')?.toString().trim();
	if (manual && /^\d{4}-\d{2}-\d{2}$/.test(manual)) return manual;
	return snapshotDateFromFilename(filename);
}

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	preview: async ({ request, locals: { safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		let upload;
		try {
			upload = await resolveUpload(formData);
		} catch (error) {
			return fail(400, {
				success: false,
				message: String((error as Error).message)
			});
		}
		if (!upload) {
			return fail(400, {
				success: false,
				message: 'Envie um arquivo xlsx exportado da Área do Investidor da B3.'
			});
		}
		const { parsed, filename } = upload;
		const snapshotDate = readSnapshotDate(formData, filename);
		if (parsed.kind === 'posicao' && !snapshotDate) {
			return fail(400, {
				success: false,
				message:
					'Não foi possível ler a data da posição pelo nome do arquivo. Informe a data do snapshot.'
			});
		}

		const items = parsed.kind === 'posicao' ? parsed.positions : parsed.events;
		const newAssets = [
			...new Map(
				items
					.filter((item) => item.spec.classGuessed)
					.map((item) => [item.spec.productKey, item.spec])
			).values()
		];

		return {
			success: true,
			kind: parsed.kind,
			kind_label: KIND_LABELS[parsed.kind],
			filename,
			snapshot_date: snapshotDate,
			total: items.length,
			warnings: parsed.warnings,
			preview_positions: parsed.positions.slice(0, 10).map((position) => ({
				product: position.rawProduct,
				quantity: position.quantity,
				net_value: position.netValue,
				asset_class: position.spec.assetClass
			})),
			preview_events: parsed.events.slice(0, 10).map((event) => ({
				date: event.eventDate,
				type: event.eventType,
				product: event.rawProduct,
				direction: event.direction,
				total_value: event.totalValue
			})),
			guessed_assets: newAssets.map((spec) => ({
				product_key: spec.productKey,
				asset_class: spec.assetClass
			}))
		};
	},

	confirm: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		let upload;
		try {
			upload = await resolveUpload(formData);
		} catch (error) {
			return fail(400, {
				success: false,
				message: String((error as Error).message)
			});
		}
		if (!upload) {
			return fail(400, {
				success: false,
				message: 'Envie novamente o arquivo xlsx para confirmar a importação.'
			});
		}
		const { parsed, filename } = upload;
		const snapshotDate = readSnapshotDate(formData, filename);
		if (parsed.kind === 'posicao' && !snapshotDate) {
			return fail(400, {
				success: false,
				message: 'Data do snapshot não informada.'
			});
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});
		}

		const result = await persistParsedB3File(
			householdId,
			user.id,
			parsed,
			filename,
			snapshotDate
		);
		if (result.errorMessage) {
			return fail(500, { success: false, message: result.errorMessage });
		}

		return {
			success: true,
			confirmed: true,
			kind: parsed.kind,
			kind_label: KIND_LABELS[parsed.kind],
			filename,
			inserted: result.inserted,
			skipped_duplicates: result.skippedDuplicates,
			assets_created: result.assetsCreated,
			warnings: parsed.warnings,
			reconciliation: result.reconciliation
		};
	}
};
