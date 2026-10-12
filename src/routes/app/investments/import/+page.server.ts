import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import {
	parseB3File,
	snapshotDateFromFilename,
	type ParsedB3File
} from '$lib/server/investment-import';
import { persistParsedB3File } from '$lib/server/investment-import-persist';
import type { ReconciliationDiff } from '$lib/server/investment-positions';
import {
	UPLOAD_TOO_LARGE_MESSAGE,
	uploadTooLarge
} from '$lib/server/request-guards';

// Mirrors app/imports: preview and confirm each re-parse the uploaded Files
// (re-sent by the page on confirm), so nothing is staged server-side. B3
// exports are small (hundreds of rows), the double parse costs milliseconds.

const MAX_FILES = 6;

const KIND_LABELS: Record<ParsedB3File['kind'], string> = {
	posicao: 'Posição (snapshot do patrimônio)',
	negociacao: 'Negociação (compras e vendas)',
	movimentacao: 'Movimentação (proventos e eventos)'
};

// Events first, snapshots last: the reconciliation of a posição compares the
// quantities derived from events already stored, so the month's movimentação
// has to be in before the snapshot is checked against it.
const PERSIST_ORDER: Record<ParsedB3File['kind'], number> = {
	negociacao: 0,
	movimentacao: 1,
	posicao: 2
};

type Upload =
	| { ok: true; filename: string; parsed: ParsedB3File }
	| { ok: false; filename: string; message: string };

async function resolveUploads(
	formData: FormData
): Promise<Upload[] | { message: string }> {
	const files = formData
		.getAll('file')
		.filter((entry): entry is File => entry instanceof File && entry.size > 0);
	if (files.length === 0) {
		return {
			message: 'Envie ao menos um xlsx exportado da Área do Investidor.'
		};
	}
	if (files.length > MAX_FILES) {
		return { message: `Envie no máximo ${MAX_FILES} arquivos por vez.` };
	}

	const uploads: Upload[] = [];
	for (const file of files) {
		if (uploadTooLarge(file)) {
			uploads.push({
				ok: false,
				filename: file.name,
				message: UPLOAD_TOO_LARGE_MESSAGE
			});
			continue;
		}
		try {
			const parsed = await parseB3File(Buffer.from(await file.arrayBuffer()));
			uploads.push({ ok: true, filename: file.name, parsed });
		} catch (error) {
			uploads.push({
				ok: false,
				filename: file.name,
				message: String((error as Error).message)
			});
		}
	}
	return uploads;
}

// With a single file the manual date wins, as before. With several, one date
// field cannot fit them all, so each file's own name decides and the manual
// date only fills the gaps.
function readSnapshotDate(
	formData: FormData,
	filename: string,
	multiple: boolean
): string | null {
	const manualRaw = formData.get('snapshot_date')?.toString().trim() ?? '';
	const manual = /^\d{4}-\d{2}-\d{2}$/.test(manualRaw) ? manualRaw : null;
	const fromName = snapshotDateFromFilename(filename);
	return multiple ? (fromName ?? manual) : (manual ?? fromName);
}

interface FilePreview {
	filename: string;
	error: string | null;
	kind: ParsedB3File['kind'] | null;
	kind_label: string | null;
	snapshot_date: string | null;
	total: number;
	warnings: string[];
	preview_positions: {
		product: string;
		quantity: number;
		net_value: number;
		asset_class: string;
	}[];
	preview_events: {
		date: string;
		type: string;
		product: string;
		direction: string;
		total_value: number | null;
	}[];
	guessed_assets: { product_key: string; asset_class: string }[];
}

interface FileResult {
	filename: string;
	error: string | null;
	kind_label: string | null;
	inserted: number;
	skipped_duplicates: number;
	assets_created: number;
	warnings: string[];
	reconciliation: ReconciliationDiff[];
}

const emptyPreview = (filename: string, error: string): FilePreview => ({
	filename,
	error,
	kind: null,
	kind_label: null,
	snapshot_date: null,
	total: 0,
	warnings: [],
	preview_positions: [],
	preview_events: [],
	guessed_assets: []
});

function previewOf(
	filename: string,
	parsed: ParsedB3File,
	snapshotDate: string | null
): FilePreview {
	if (parsed.kind === 'posicao' && !snapshotDate) {
		return emptyPreview(
			filename,
			'Não foi possível ler a data da posição pelo nome do arquivo. Informe a data do snapshot.'
		);
	}
	const items = parsed.kind === 'posicao' ? parsed.positions : parsed.events;
	const guessed = [
		...new Map(
			items
				.filter((item) => item.spec.classGuessed)
				.map((item) => [item.spec.productKey, item.spec])
		).values()
	];
	return {
		filename,
		error: null,
		kind: parsed.kind,
		kind_label: KIND_LABELS[parsed.kind],
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
		guessed_assets: guessed.map((spec) => ({
			product_key: spec.productKey,
			asset_class: spec.assetClass
		}))
	};
}

export const load: PageServerLoad = async () => {
	return {};
};

export const actions: Actions = {
	preview: async ({ request, locals: { safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const uploads = await resolveUploads(formData);
		if ('message' in uploads) {
			return fail(400, { success: false, message: uploads.message });
		}

		const multiple = uploads.length > 1;
		const files: FilePreview[] = uploads.map((upload) =>
			upload.ok
				? previewOf(
						upload.filename,
						upload.parsed,
						readSnapshotDate(formData, upload.filename, multiple)
					)
				: emptyPreview(upload.filename, upload.message)
		);
		const valid = files.filter((file) => !file.error);
		if (valid.length === 0) {
			return fail(400, {
				success: false,
				message: files
					.map((file) => `${file.filename}: ${file.error}`)
					.join(' ')
			});
		}

		return {
			success: true,
			files,
			total: valid.reduce((sum, file) => sum + file.total, 0)
		};
	},

	confirm: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const uploads = await resolveUploads(formData);
		if ('message' in uploads) {
			return fail(400, { success: false, message: uploads.message });
		}

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});
		}

		const multiple = uploads.length > 1;
		const results: FileResult[] = [];
		const failed = (filename: string, error: string): FileResult => ({
			filename,
			error,
			kind_label: null,
			inserted: 0,
			skipped_duplicates: 0,
			assets_created: 0,
			warnings: [],
			reconciliation: []
		});

		for (const upload of uploads.filter((item) => !item.ok)) {
			results.push(
				failed(upload.filename, (upload as { message: string }).message)
			);
		}

		const ready = uploads
			.filter((upload): upload is Extract<Upload, { ok: true }> => upload.ok)
			.sort(
				(a, b) => PERSIST_ORDER[a.parsed.kind] - PERSIST_ORDER[b.parsed.kind]
			);

		for (const { filename, parsed } of ready) {
			const snapshotDate = readSnapshotDate(formData, filename, multiple);
			if (parsed.kind === 'posicao' && !snapshotDate) {
				results.push(failed(filename, 'Data do snapshot não informada.'));
				continue;
			}
			const result = await persistParsedB3File(
				householdId,
				user.id,
				parsed,
				filename,
				snapshotDate
			);
			if (result.errorMessage) {
				results.push(failed(filename, result.errorMessage));
				continue;
			}
			results.push({
				filename,
				error: null,
				kind_label: KIND_LABELS[parsed.kind],
				inserted: result.inserted,
				skipped_duplicates: result.skippedDuplicates,
				assets_created: result.assetsCreated,
				warnings: parsed.warnings,
				reconciliation: result.reconciliation
			});
		}

		if (results.every((result) => result.error)) {
			return fail(500, {
				success: false,
				message: results
					.map((result) => `${result.filename}: ${result.error}`)
					.join(' ')
			});
		}

		return { success: true, confirmed: true, results };
	}
};
