// Pure position math: how each B3 movimentação event type affects a holding,
// how current quantities derive from the latest snapshot plus later events,
// and how a derived position reconciles against an official posição upload.
//
// Everything here takes plain rows and returns plain values so the whole
// module is unit-testable without a database.

export interface SnapshotRow {
	asset_id: string;
	snapshot_date: string; // ISO date
	quantity: number;
	close_price: number | null;
	net_value: number;
}

export interface EventRow {
	asset_id: string;
	event_date: string; // ISO date
	event_type: string;
	direction: 'credit' | 'debit';
	quantity: number | null;
	unit_price: number | null;
	total_value: number | null;
	source: 'b3_movimentacao' | 'b3_negociacao' | 'manual';
}

export interface QuoteRow {
	asset_id: string;
	quote_date: string;
	price: number;
	// Where the price came from. Valuation ignores it, but the return curve
	// only trusts dates the cron actually priced.
	source?: string;
}

export type EventEffect =
	| 'quantity' // moves the position size (sign from direction)
	| 'restatement' // declares the whole position, replacing it
	| 'income' // cash in, size untouched (dividends, juros)
	| 'fee' // cash out, size untouched
	| 'cost_basis' // changes the tax cost basis, size untouched (FII amortization)
	| 'none' // informational rows (unexercised rights, cessões)
	| 'unknown'; // never silently dropped — surfaced as a warning in the UI

const EFFECT_BY_TYPE: Record<string, EventEffect> = {
	// Quantity movers. "Transferência - Liquidação" is how trades settle in
	// movimentação — the same trade also exists in negociação, which is why
	// quantities must derive from movimentação alone (see deriveQuantity).
	'transferencia - liquidacao': 'quantity',
	transferencia: 'quantity',
	compra: 'quantity',
	venda: 'quantity',
	aplicacao: 'quantity',
	'resgate antecipado': 'quantity',
	resgate: 'quantity',
	vencimento: 'quantity',
	// "Atualização" restates the whole holding rather than moving it: B3 emits
	// it periodically with the position's full size. Adding it as a delta
	// multiplies the holding — BOVA11 carries 16 of them, all reading 170,
	// which is exactly the position.
	atualizacao: 'restatement',
	desdobro: 'quantity',
	grupamento: 'quantity',
	'bonificacao em ativos': 'quantity',
	'fracao em ativos': 'quantity',
	solicitacao_de_subscricao: 'quantity',

	// Income (position size untouched).
	rendimento: 'income',
	juros: 'income',
	'pagamento de juros': 'income',
	dividendo: 'income',
	'juros sobre capital proprio': 'income',
	'leilao de fracao': 'income',

	// Fees.
	'cobranca de taxa semestral': 'fee',

	// Cost basis only (FII amortization returns capital without moving quotas).
	amortizacao: 'cost_basis',

	// Informational.
	'direitos de subscricao - nao exercido': 'none',
	'cessao de direitos': 'none',
	'cessao de direitos - solicitada': 'none'
};

function normalizeType(eventType: string): string {
	return eventType.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function classifyEvent(
	event: Pick<EventRow, 'event_type' | 'total_value'>
): EventEffect {
	const normalized = normalizeType(event.event_type);
	// Subscription rights only change the position when actually exercised,
	// which B3 reports as a row with a real operation value.
	if (normalized === 'direito de subscricao' || normalized === 'subscricao') {
		return (event.total_value ?? 0) > 0 ? 'quantity' : 'none';
	}
	return EFFECT_BY_TYPE[normalized] ?? 'unknown';
}

export interface DerivedPosition {
	assetId: string;
	quantity: number;
	baselineDate: string | null; // last official snapshot used
	unknownEventTypes: string[];
}

function latestSnapshotFor(
	assetId: string,
	snapshots: SnapshotRow[],
	cutoff: string
): SnapshotRow | null {
	let baseline: SnapshotRow | null = null;
	for (const snapshot of snapshots) {
		if (snapshot.asset_id !== assetId || snapshot.snapshot_date > cutoff)
			continue;
		if (!baseline || snapshot.snapshot_date > baseline.snapshot_date)
			baseline = snapshot;
	}
	return baseline;
}

function countsForDerivation(
	event: EventRow,
	assetId: string,
	cutoff: string,
	baseline: SnapshotRow | null
): boolean {
	if (event.asset_id !== assetId || event.source === 'b3_negociacao')
		return false;
	if (event.event_date > cutoff) return false;
	return !baseline || event.event_date > baseline.snapshot_date;
}

// Nothing here can be held short: the B3 export only ever describes what the
// investor owns. A running total that goes below zero means the acquisition
// happened before the available history — Tesouro Selic 2025 shows its own
// redemption with no matching purchase — and the honest answer is an empty
// position, not a negative one that would subtract from the patrimony.
function notNegative(quantity: number): number {
	return quantity > 0 ? quantity : 0;
}

function earliestSnapshotAfter(
	assetId: string,
	snapshots: SnapshotRow[],
	cutoff: string
): SnapshotRow | null {
	let earliest: SnapshotRow | null = null;
	for (const snapshot of snapshots) {
		if (snapshot.asset_id !== assetId || snapshot.snapshot_date <= cutoff)
			continue;
		if (!earliest || snapshot.snapshot_date < earliest.snapshot_date)
			earliest = snapshot;
	}
	return earliest;
}

// Signed quantity change of one event, or null when it does not move the size.
function quantityDelta(event: EventRow): number | null {
	if (classifyEvent(event) !== 'quantity' || event.quantity === null)
		return null;
	return event.direction === 'credit' ? event.quantity : -event.quantity;
}

// Walks back from a snapshot that lies in the future of the asked date,
// undoing everything that happened in between. Without this, any date before
// the first snapshot would be answered from an empty position — reading a
// fund's whole balance as if it had appeared out of nowhere that month.
function quantityBefore(
	assetId: string,
	future: SnapshotRow,
	events: EventRow[],
	cutoff: string
): number {
	let quantity = future.quantity;
	for (const event of events) {
		if (event.asset_id !== assetId || event.source === 'b3_negociacao')
			continue;
		if (event.event_date <= cutoff || event.event_date > future.snapshot_date)
			continue;
		const delta = quantityDelta(event);
		if (delta !== null) quantity -= delta;
	}
	return quantity;
}

function unknownTypesFor(
	assetId: string,
	events: EventRow[],
	cutoff: string
): string[] {
	const unknown = new Set<string>();
	for (const event of events) {
		if (event.asset_id !== assetId || event.source === 'b3_negociacao')
			continue;
		if (event.event_date > cutoff) continue;
		if (classifyEvent(event) === 'unknown') unknown.add(event.event_type);
	}
	return [...unknown];
}

function quantityForward(
	assetId: string,
	baseline: SnapshotRow | null,
	events: EventRow[],
	cutoff: string
): number {
	let quantity = baseline?.quantity ?? 0;
	for (const event of events) {
		if (!countsForDerivation(event, assetId, cutoff, baseline)) continue;
		if (classifyEvent(event) === 'restatement' && event.quantity !== null) {
			// The position as B3 declares it, replacing whatever we had.
			quantity = event.quantity;
			continue;
		}
		const delta = quantityDelta(event);
		if (delta !== null) quantity += delta;
	}
	return quantity;
}

// Current quantity = nearest snapshot plus the events between it and the asked
// date, applied forwards or backwards depending on which side the snapshot
// falls. Only movimentação (and manual) events count: negociação rows describe
// the same trades that settle as "Transferência - Liquidação" and would double.
export function deriveQuantity(
	assetId: string,
	snapshots: SnapshotRow[],
	events: EventRow[],
	asOf?: string
): DerivedPosition {
	const cutoff = asOf ?? '9999-12-31';
	const baseline = latestSnapshotFor(assetId, snapshots, cutoff);
	const unknown = unknownTypesFor(assetId, events, cutoff);

	if (!baseline) {
		const future = earliestSnapshotAfter(assetId, snapshots, cutoff);
		if (future) {
			return {
				assetId,
				quantity: notNegative(quantityBefore(assetId, future, events, cutoff)),
				baselineDate: future.snapshot_date,
				unknownEventTypes: unknown
			};
		}
	}

	return {
		assetId,
		quantity: notNegative(quantityForward(assetId, baseline, events, cutoff)),
		baselineDate: baseline?.snapshot_date ?? null,
		unknownEventTypes: unknown
	};
}

// Latest known price for an asset: freshest quote, else the most recent
// snapshot's implied price. Renda fixa without quotes falls back to the last
// official value this way.
function latestQuoteFor(
	assetId: string,
	quotes: QuoteRow[]
): { price: number; date: string } | null {
	let best: { price: number; date: string } | null = null;
	for (const quote of quotes) {
		if (quote.asset_id !== assetId) continue;
		if (!best || quote.quote_date > best.date)
			best = { price: quote.price, date: quote.quote_date };
	}
	return best;
}

export function latestPrice(
	assetId: string,
	quotes: QuoteRow[],
	snapshots: SnapshotRow[]
): { price: number; date: string } | null {
	const quote = latestQuoteFor(assetId, quotes);
	if (quote) return quote;
	const snapshot = latestSnapshotFor(assetId, snapshots, '9999-12-31');
	if (!snapshot) return null;
	const implied =
		snapshot.close_price ??
		(snapshot.quantity !== 0 ? snapshot.net_value / snapshot.quantity : null);
	return implied === null
		? null
		: { price: implied, date: snapshot.snapshot_date };
}

export interface ReconciliationDiff {
	assetId: string;
	derivedQuantity: number;
	officialQuantity: number;
	delta: number;
}

// Compares the quantity the event stream predicts for the snapshot date with
// what B3 officially reports. Non-zero deltas usually mean missing
// movimentação months (or an event type we map wrongly) — informational only,
// because the snapshot becomes the new baseline regardless.
export function reconcile(
	officialPositions: { asset_id: string; quantity: number }[],
	snapshotDate: string,
	priorSnapshots: SnapshotRow[],
	events: EventRow[],
	toleranceRatio = 1e-9
): ReconciliationDiff[] {
	const diffs: ReconciliationDiff[] = [];
	for (const official of officialPositions) {
		const derived = deriveQuantity(
			official.asset_id,
			priorSnapshots,
			events,
			snapshotDate
		);
		if (derived.baselineDate === null) continue; // first snapshot: nothing to compare
		const delta = official.quantity - derived.quantity;
		const tolerance = Math.abs(official.quantity) * toleranceRatio;
		if (Math.abs(delta) > tolerance) {
			diffs.push({
				assetId: official.asset_id,
				derivedQuantity: derived.quantity,
				officialQuantity: official.quantity,
				delta
			});
		}
	}
	return diffs;
}

// Papers that accumulate instead of paying periodically (LCA, LCI, CDB,
// prefixados) release their whole interest in one credit when they mature.
// That credit is real money, but it is the yield of the paper's entire life —
// counting it as the month's passive income makes one month look like twenty.
// The tell is a redemption of the same asset on the same date.
const REDEMPTION_TYPES = new Set([
	'vencimento',
	'resgate',
	'resgate antecipado'
]);

function redemptionKeys(events: EventRow[]): Set<string> {
	const keys = new Set<string>();
	for (const event of events) {
		if (REDEMPTION_TYPES.has(normalizeType(event.event_type))) {
			keys.add(`${event.asset_id}|${event.event_date}`);
		}
	}
	return keys;
}

export interface IncomeMonth {
	month: string; // YYYY-MM
	recurring: number; // dividends, rent, coupons — the real monthly income
	maturity: number; // interest released at redemption, shown apart
}

// Monthly passive income, split so that lump-sum maturity payouts never
// distort the recurring series.
export function monthlyPassiveIncome(events: EventRow[]): IncomeMonth[] {
	const redemptions = redemptionKeys(events);
	const byMonth = new Map<string, IncomeMonth>();
	for (const event of events) {
		if (classifyEvent(event) !== 'income' || event.direction !== 'credit')
			continue;
		const month = event.event_date.slice(0, 7);
		const entry = byMonth.get(month) ?? { month, recurring: 0, maturity: 0 };
		const value = event.total_value ?? 0;
		if (redemptions.has(`${event.asset_id}|${event.event_date}`)) {
			entry.maturity += value;
		} else {
			entry.recurring += value;
		}
		byMonth.set(month, entry);
	}
	return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export interface EvolutionPoint {
	date: string;
	totalValue: number;
	source: 'snapshot' | 'computed';
}

// Patrimony curve: one point per snapshot date (official totals) plus one
// computed "today" point from derived quantities × latest prices.
export function evolutionSeries(
	snapshots: SnapshotRow[],
	events: EventRow[],
	quotes: QuoteRow[],
	today: string
): EvolutionPoint[] {
	const byDate = new Map<string, number>();
	for (const snapshot of snapshots) {
		byDate.set(
			snapshot.snapshot_date,
			(byDate.get(snapshot.snapshot_date) ?? 0) + snapshot.net_value
		);
	}
	const points: EvolutionPoint[] = [...byDate.entries()]
		.map(([date, totalValue]) => ({
			date,
			totalValue,
			source: 'snapshot' as const
		}))
		.sort((a, b) => a.date.localeCompare(b.date));

	const assetIds = new Set(snapshots.map((row) => row.asset_id));
	for (const event of events) assetIds.add(event.asset_id);
	let computedTotal = 0;
	let priced = false;
	for (const assetId of assetIds) {
		const derived = deriveQuantity(assetId, snapshots, events);
		if (derived.quantity === 0) continue;
		const price = latestPrice(assetId, quotes, snapshots);
		if (!price) continue;
		computedTotal += derived.quantity * price.price;
		priced = true;
	}
	const lastSnapshotDate = points.at(-1)?.date;
	if (priced && (!lastSnapshotDate || today > lastSnapshotDate)) {
		points.push({ date: today, totalValue: computedTotal, source: 'computed' });
	}
	return points;
}
