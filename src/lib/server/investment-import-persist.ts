import { supabaseAdmin } from '$lib/server/supabase';
import type {
	ParsedB3File,
	ParsedEvent,
	ParsedPosition
} from './investment-import';
import {
	reconcile,
	type EventRow,
	type ReconciliationDiff,
	type SnapshotRow
} from './investment-positions';

// Persists a parsed B3 file for one owner. All writes go through supabaseAdmin
// (service role), so every statement filters household_id explicitly — RLS is
// not the guard on this path (see SECURITY.md).

export interface PersistResult {
	importId: string;
	assetsCreated: number;
	inserted: number;
	skippedDuplicates: number;
	reconciliation: ReconciliationDiff[];
	errorMessage?: string;
}

interface AssetRef {
	id: string;
	product_key: string;
}

// A posição sheet knows the real class of each holding; movimentação-created
// assets carry heuristic guesses that get corrected here.
async function updateAuthoritativeAssets(
	householdId: string,
	existing: AssetRef[],
	specs: Map<string, ParsedPosition['spec']>
): Promise<string | null> {
	for (const row of existing) {
		const spec = specs.get(row.product_key);
		if (!spec || spec.classGuessed) continue;
		const { error } = await supabaseAdmin
			.from('investment_assets')
			.update({
				asset_class: spec.assetClass,
				tax_bucket: spec.taxBucket,
				name: spec.name,
				issuer: spec.issuer
			})
			.eq('id', row.id)
			.eq('household_id', householdId);
		if (error) return error.message;
	}
	return null;
}

async function markFailed(importId: string, message: string) {
	console.error('[investments/import]', message);
	await supabaseAdmin
		.from('transaction_imports')
		.update({ status: 'failed' })
		.eq('id', importId);
}

// Resolves parsed specs to investment_assets rows, creating the missing ones.
// A posição import is authoritative about classification, so it also corrects
// class/bucket of assets first seen through movimentação heuristics; the other
// files never update existing assets.
async function resolveAssets(
	householdId: string,
	ownerUserId: string,
	items: { spec: ParsedPosition['spec'] }[],
	authoritative: boolean
): Promise<
	{ byKey: Map<string, string>; created: number } | { errorMessage: string }
> {
	const specs = new Map(items.map((item) => [item.spec.productKey, item.spec]));
	const keys = [...specs.keys()];
	if (keys.length === 0) return { byKey: new Map(), created: 0 };

	const { data: existing, error: selectError } = await supabaseAdmin
		.from('investment_assets')
		.select('id, product_key')
		.eq('household_id', householdId)
		.eq('owner_user_id', ownerUserId)
		.in('product_key', keys);
	if (selectError) return { errorMessage: selectError.message };

	const byKey = new Map<string, string>(
		(existing ?? []).map((row: AssetRef) => [row.product_key, row.id])
	);

	if (authoritative) {
		const updateError = await updateAuthoritativeAssets(
			householdId,
			(existing ?? []) as AssetRef[],
			specs
		);
		if (updateError) return { errorMessage: updateError };
	}

	const missing = keys.filter((key) => !byKey.has(key));
	if (missing.length > 0) {
		const { data: inserted, error } = await supabaseAdmin
			.from('investment_assets')
			.insert(
				missing.map((key) => {
					const spec = specs.get(key)!;
					return {
						household_id: householdId,
						owner_user_id: ownerUserId,
						asset_class: spec.assetClass,
						ticker: spec.ticker,
						name: spec.name,
						product_key: spec.productKey,
						issuer: spec.issuer,
						tax_bucket: spec.taxBucket
					};
				})
			)
			.select('id, product_key');
		if (error) return { errorMessage: error.message };
		for (const row of (inserted ?? []) as AssetRef[])
			byKey.set(row.product_key, row.id);
	}
	return { byKey, created: missing.length };
}

// Issue date, maturity and indexer come from the position sheet and describe
// the paper itself, so they are filled once and never overwritten: a maturity
// does not change, and the indexer B3 omits is one the user declared by hand.
interface PositionMetadata {
	issueDate: string | null;
	maturityDate: string | null;
	indexType: string | null;
}

function positionMetadata(
	positions: ParsedPosition[],
	byKey: Map<string, string>
): Map<string, PositionMetadata> {
	const parsed = new Map<string, PositionMetadata>();
	for (const position of positions) {
		const assetId = byKey.get(position.spec.productKey);
		const described =
			position.issueDate || position.maturityDate || position.indexType;
		if (!assetId || !described) continue;
		parsed.set(assetId, {
			issueDate: position.issueDate,
			maturityDate: position.maturityDate,
			indexType: position.indexType
		});
	}
	return parsed;
}

// Only the columns still empty. A maturity does not change, and an indexer the
// file omits is one the user declared by hand — neither may be overwritten.
function metadataUpdate(
	row: Record<string, unknown>,
	incoming: PositionMetadata
): Record<string, string> {
	const update: Record<string, string> = {};
	if (!row.issue_date && incoming.issueDate)
		update.issue_date = incoming.issueDate;
	if (!row.maturity_date && incoming.maturityDate)
		update.maturity_date = incoming.maturityDate;
	if (!row.index_type && incoming.indexType)
		update.index_type = incoming.indexType;
	return update;
}

async function applyPositionMetadata(
	householdId: string,
	positions: ParsedPosition[],
	byKey: Map<string, string>
): Promise<string | null> {
	const parsed = positionMetadata(positions, byKey);
	if (parsed.size === 0) return null;

	const { data: current, error } = await supabaseAdmin
		.from('investment_assets')
		.select('id, issue_date, maturity_date, index_type')
		.eq('household_id', householdId)
		.in('id', [...parsed.keys()]);
	if (error) return error.message;

	for (const row of current ?? []) {
		const incoming = parsed.get(row.id as string);
		const update = incoming ? metadataUpdate(row, incoming) : {};
		if (Object.keys(update).length === 0) continue;
		const { error: updateError } = await supabaseAdmin
			.from('investment_assets')
			.update(update)
			.eq('id', row.id)
			.eq('household_id', householdId);
		if (updateError) return updateError.message;
	}
	return null;
}

async function persistPositions(
	householdId: string,
	positions: ParsedPosition[],
	byKey: Map<string, string>,
	snapshotDate: string,
	importId: string
): Promise<
	| { inserted: number; reconciliation: ReconciliationDiff[] }
	| { errorMessage: string }
> {
	const metadataError = await applyPositionMetadata(
		householdId,
		positions,
		byKey
	);
	if (metadataError) return { errorMessage: metadataError };

	const assetIds = [
		...new Set(positions.map((p) => byKey.get(p.spec.productKey)!))
	];

	// Prior state loads before the upsert so the reconciliation compares the
	// derived quantities against what B3 now reports.
	const [
		{ data: priorSnapshots, error: snapError },
		{ data: priorEvents, error: eventsError }
	] = await Promise.all([
		supabaseAdmin
			.from('investment_snapshots')
			.select('asset_id, snapshot_date, quantity, close_price, net_value')
			.eq('household_id', householdId)
			.in('asset_id', assetIds)
			.lt('snapshot_date', snapshotDate),
		supabaseAdmin
			.from('investment_events')
			.select(
				'asset_id, event_date, event_type, direction, quantity, unit_price, total_value, source'
			)
			.eq('household_id', householdId)
			.in('asset_id', assetIds)
			.lte('event_date', snapshotDate)
	]);
	if (snapError) return { errorMessage: snapError.message };
	if (eventsError) return { errorMessage: eventsError.message };

	const reconciliation = reconcile(
		positions.map((p) => ({
			asset_id: byKey.get(p.spec.productKey)!,
			quantity: p.quantity
		})),
		snapshotDate,
		(priorSnapshots ?? []) as SnapshotRow[],
		(priorEvents ?? []) as EventRow[]
	);

	const { data, error } = await supabaseAdmin
		.from('investment_snapshots')
		.upsert(
			positions.map((position) => ({
				household_id: householdId,
				asset_id: byKey.get(position.spec.productKey)!,
				snapshot_date: snapshotDate,
				institution: position.institution,
				quantity: position.quantity,
				close_price: position.closePrice,
				gross_value: position.grossValue,
				net_value: position.netValue,
				applied_value: position.appliedValue,
				import_id: importId
			})),
			{
				onConflict: 'household_id,asset_id,snapshot_date',
				ignoreDuplicates: true
			}
		)
		.select('id');
	if (error) return { errorMessage: error.message };

	// Snapshot prices double as quotes so valuation works before the cron ever
	// runs (and forever, for renda fixa nothing public quotes).
	const quotes = positions
		.filter((position) => position.closePrice !== null)
		.map((position) => ({
			household_id: householdId,
			asset_id: byKey.get(position.spec.productKey)!,
			quote_date: snapshotDate,
			price: position.closePrice!,
			source: 'snapshot'
		}));
	if (quotes.length > 0) {
		const { error: quoteError } = await supabaseAdmin
			.from('investment_quotes')
			.upsert(quotes, {
				onConflict: 'asset_id,quote_date',
				ignoreDuplicates: true
			});
		if (quoteError) return { errorMessage: quoteError.message };
	}

	return { inserted: data?.length ?? 0, reconciliation };
}

async function persistEvents(
	householdId: string,
	events: ParsedEvent[],
	byKey: Map<string, string>,
	importId: string
): Promise<{ inserted: number } | { errorMessage: string }> {
	if (events.length === 0) return { inserted: 0 };
	const { data, error } = await supabaseAdmin
		.from('investment_events')
		.upsert(
			events.map((event) => ({
				household_id: householdId,
				asset_id: byKey.get(event.spec.productKey)!,
				event_date: event.eventDate,
				event_type: event.eventType,
				direction: event.direction,
				quantity: event.quantity,
				unit_price: event.unitPrice,
				total_value: event.totalValue,
				institution: event.institution,
				raw_product: event.rawProduct,
				source: event.source,
				dedup_key: event.dedupKey,
				import_id: importId
			})),
			{ onConflict: 'household_id,dedup_key', ignoreDuplicates: true }
		)
		.select('id');
	if (error) return { errorMessage: error.message };
	return { inserted: data?.length ?? 0 };
}

export async function persistParsedB3File(
	householdId: string,
	ownerUserId: string,
	parsed: ParsedB3File,
	sourceFilename: string,
	snapshotDate: string | null
): Promise<PersistResult> {
	const totalRows =
		parsed.kind === 'posicao' ? parsed.positions.length : parsed.events.length;
	const { data: importRow, error: importError } = await supabaseAdmin
		.from('transaction_imports')
		.insert({
			household_id: householdId,
			created_by_user_id: ownerUserId,
			source_filename: sourceFilename,
			source_type: `b3_${parsed.kind}`,
			status: 'parsed',
			row_count: totalRows
		})
		.select('id')
		.single();
	if (importError || !importRow) {
		return {
			importId: '',
			assetsCreated: 0,
			inserted: 0,
			skippedDuplicates: 0,
			reconciliation: [],
			errorMessage: importError?.message ?? 'Falha ao registrar o import.'
		};
	}
	const importId = importRow.id as string;

	const failure = (message: string): Promise<PersistResult> =>
		markFailed(importId, message).then(() => ({
			importId,
			assetsCreated: 0,
			inserted: 0,
			skippedDuplicates: 0,
			reconciliation: [],
			errorMessage: message
		}));

	const items = parsed.kind === 'posicao' ? parsed.positions : parsed.events;
	const assets = await resolveAssets(
		householdId,
		ownerUserId,
		items,
		parsed.kind === 'posicao'
	);
	if ('errorMessage' in assets) return failure(assets.errorMessage);

	if (parsed.kind === 'posicao') {
		if (!snapshotDate)
			return failure('Data do snapshot de posição não informada.');
		const result = await persistPositions(
			householdId,
			parsed.positions,
			assets.byKey,
			snapshotDate,
			importId
		);
		if ('errorMessage' in result) return failure(result.errorMessage);
		return {
			importId,
			assetsCreated: assets.created,
			inserted: result.inserted,
			skippedDuplicates: parsed.positions.length - result.inserted,
			reconciliation: result.reconciliation
		};
	}

	const result = await persistEvents(
		householdId,
		parsed.events,
		assets.byKey,
		importId
	);
	if ('errorMessage' in result) return failure(result.errorMessage);
	return {
		importId,
		assetsCreated: assets.created,
		inserted: result.inserted,
		skippedDuplicates: parsed.events.length - result.inserted,
		reconciliation: []
	};
}
