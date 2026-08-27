// Pure IR (capital gains) engine for the investments module.
//
// Rules implemented (vigentes em 2026 — MP 1.303 caducou em out/2025):
// - FII/Fiagro: 20% sobre ganho na venda, sem isenção; prejuízo compensa
//   somente ganhos futuros da própria cesta.
// - Ações à vista: 15%; vendas brutas até R$ 20.000 no mês isentam o ganho
//   (prejuízos seguem compensáveis); acima disso, ganho integral tributa.
// - ETFs de renda variável: 15%, sem a isenção dos R$ 20 mil.
// - tesouro/CDB/ETF RF (retido_fonte) e LCA/LCI/rendimento FII (isento):
//   fora da apuração — imposto retido na fonte ou inexistente.
// - DARF código 6015, vencimento no último dia útil do mês seguinte; valor
//   abaixo de R$ 10 acumula para o mês seguinte (art. 68 Lei 9.430/96).
//
// Cost basis is a chronological weighted-average pass per asset. Trades are
// taken from negociação rows when a month has them for the asset (real trade
// date and price); otherwise from movimentação settlement rows — never both,
// or the same trade would count twice.

import { classifyEvent, type EventRow } from './investment-positions';
import type { TaxBucket } from './investment-assets';

export interface TaxAssetRow {
	id: string;
	tax_bucket: TaxBucket;
	override_quantity: number | null;
	override_total_cost: number | null;
	override_date: string | null;
}

export const DARF_MINIMUM = 10;
export const ACOES_EXEMPTION_LIMIT = 20000;

const BUCKET_RATES: Record<'fii' | 'acoes' | 'etf_rv', number> = {
	fii: 0.2,
	acoes: 0.15,
	etf_rv: 0.15
};

type ApuravelBucket = keyof typeof BUCKET_RATES;

function isApuravel(bucket: TaxBucket): bucket is ApuravelBucket {
	return bucket in BUCKET_RATES;
}

interface TradeLot {
	date: string; // ISO
	kind: 'buy' | 'sell';
	quantity: number;
	value: number; // absolute financial value of the trade
}

const TRADE_TYPES = new Set(['transferencia - liquidacao', 'compra', 'venda']);

function normalizeType(eventType: string): string {
	return eventType.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function month(date: string): string {
	return date.slice(0, 7);
}

function lotFromEvent(event: EventRow): TradeLot | null {
	if (event.quantity === null) return null;
	return {
		date: event.event_date,
		kind: event.direction === 'debit' ? 'sell' : 'buy',
		quantity: event.quantity,
		value: event.total_value ?? event.quantity * (event.unit_price ?? 0)
	};
}

// Builds the chronological trade list for one asset, choosing per month
// between negociação (preferred) and movimentação settlements.
export function buildTradeLots(events: EventRow[]): TradeLot[] {
	const negotiationMonths = new Set(
		events
			.filter((e) => e.source === 'b3_negociacao')
			.map((e) => month(e.event_date))
	);
	const lots: TradeLot[] = [];
	for (const event of events) {
		const isNegotiation = event.source === 'b3_negociacao';
		const isFallbackSettlement =
			!isNegotiation &&
			TRADE_TYPES.has(normalizeType(event.event_type)) &&
			!negotiationMonths.has(month(event.event_date));
		if (!isNegotiation && !isFallbackSettlement) continue;
		const lot = lotFromEvent(event);
		if (lot) lots.push(lot);
	}
	return lots.sort((a, b) => a.date.localeCompare(b.date));
}

export interface RealizedSale {
	assetId: string;
	date: string;
	quantity: number;
	saleValue: number;
	costBasis: number;
	gain: number;
}

export interface AssetCost {
	assetId: string;
	quantity: number;
	totalCost: number;
	averageCost: number | null;
}

interface BasisState {
	quantity: number;
	totalCost: number;
	sales: RealizedSale[];
}

interface BasisEvent {
	date: string;
	apply: (state: BasisState) => void;
}

function applyTradeLot(assetId: string, lot: TradeLot, state: BasisState) {
	if (lot.kind === 'buy') {
		state.quantity += lot.quantity;
		state.totalCost += lot.value;
		return;
	}
	const sellQuantity = Math.min(lot.quantity, state.quantity);
	const averageCost = state.quantity > 0 ? state.totalCost / state.quantity : 0;
	const costBasis = averageCost * sellQuantity;
	state.sales.push({
		assetId,
		date: lot.date,
		quantity: lot.quantity,
		saleValue: lot.value,
		costBasis,
		gain: lot.value - costBasis
	});
	state.quantity -= sellQuantity;
	state.totalCost -= costBasis;
}

// Non-trade quantity changes (bonificação, desdobro, subscrição exercida...).
// Subscriptions carry a value that joins the basis; bonuses and splits change
// quantity at zero cost.
function applyCorporateAction(event: EventRow, state: BasisState) {
	if (event.direction === 'credit') {
		state.quantity += event.quantity!;
		state.totalCost += event.total_value ?? 0;
		return;
	}
	const removed = Math.min(event.quantity!, state.quantity);
	const averageCost = state.quantity > 0 ? state.totalCost / state.quantity : 0;
	state.quantity -= removed;
	state.totalCost = Math.max(0, state.totalCost - averageCost * removed);
}

function collectBasisEvents(
	asset: TaxAssetRow,
	events: EventRow[]
): BasisEvent[] {
	const basisEvents: BasisEvent[] = [];
	if (asset.override_quantity !== null && asset.override_total_cost !== null) {
		basisEvents.push({
			date: asset.override_date ?? '0000-01-01',
			apply: (state) => {
				state.quantity += asset.override_quantity!;
				state.totalCost += asset.override_total_cost!;
			}
		});
	}
	for (const lot of buildTradeLots(events)) {
		basisEvents.push({
			date: lot.date,
			apply: (state) => applyTradeLot(asset.id, lot, state)
		});
	}
	for (const event of events) {
		if (event.source === 'b3_negociacao') continue;
		const effect = classifyEvent(event);
		if (effect === 'cost_basis' && event.direction === 'credit') {
			// FII amortization: capital returned, quotas unchanged, basis drops.
			basisEvents.push({
				date: event.event_date,
				apply: (state) => {
					state.totalCost = Math.max(
						0,
						state.totalCost - (event.total_value ?? 0)
					);
				}
			});
		} else if (
			effect === 'quantity' &&
			!TRADE_TYPES.has(normalizeType(event.event_type)) &&
			event.quantity !== null
		) {
			basisEvents.push({
				date: event.event_date,
				apply: (state) => applyCorporateAction(event, state)
			});
		}
	}
	return basisEvents;
}

// One chronological pass per asset: weighted-average cost with FII
// amortizations reducing basis and exercised subscriptions adding to it.
export function computeCostBasis(
	asset: TaxAssetRow,
	events: EventRow[]
): { cost: AssetCost; sales: RealizedSale[] } {
	const state: BasisState = { quantity: 0, totalCost: 0, sales: [] };
	const basisEvents = collectBasisEvents(asset, events);
	basisEvents.sort((a, b) => a.date.localeCompare(b.date));
	for (const basisEvent of basisEvents) basisEvent.apply(state);
	return {
		cost: {
			assetId: asset.id,
			quantity: state.quantity,
			totalCost: state.totalCost,
			averageCost: state.quantity > 0 ? state.totalCost / state.quantity : null
		},
		sales: state.sales
	};
}

export interface BucketMonth {
	grossSales: number;
	gain: number; // raw month result (can be negative)
	lossOffset: number; // prior losses consumed this month
	taxableGain: number;
	tax: number;
	exempt: boolean; // ações under the R$20k rule
}

export interface TaxMonth {
	month: string; // YYYY-MM
	buckets: Partial<Record<ApuravelBucket, BucketMonth>>;
	taxDue: number; // this month's computed tax
	darfAmount: number; // what actually must be paid (0 while accruing < R$10)
	carriedIntoNext: number; // sub-R$10 amount pushed forward
	dueDate: string; // last business day of the following month
}

export interface TaxReport {
	months: TaxMonth[];
	costs: AssetCost[];
	carryforwardLosses: Record<ApuravelBucket, number>;
}

type MonthSales = Map<string, { bucket: ApuravelBucket; sale: RealizedSale }[]>;

function collectCostsAndSales(
	assets: TaxAssetRow[],
	events: EventRow[]
): { costs: AssetCost[]; salesByMonth: MonthSales } {
	const eventsByAsset = new Map<string, EventRow[]>();
	for (const event of events) {
		const list = eventsByAsset.get(event.asset_id) ?? [];
		list.push(event);
		eventsByAsset.set(event.asset_id, list);
	}

	const costs: AssetCost[] = [];
	const salesByMonth: MonthSales = new Map();
	for (const asset of assets) {
		const { cost, sales } = computeCostBasis(
			asset,
			eventsByAsset.get(asset.id) ?? []
		);
		costs.push(cost);
		if (!isApuravel(asset.tax_bucket)) continue;
		for (const sale of sales) {
			const key = month(sale.date);
			const list = salesByMonth.get(key) ?? [];
			list.push({ bucket: asset.tax_bucket, sale });
			salesByMonth.set(key, list);
		}
	}
	return { costs, salesByMonth };
}

export function computeTaxReport(
	assets: TaxAssetRow[],
	events: EventRow[]
): TaxReport {
	const { costs, salesByMonth } = collectCostsAndSales(assets, events);

	const monthKeys = [...salesByMonth.keys()].sort();
	const losses: Record<ApuravelBucket, number> = {
		fii: 0,
		acoes: 0,
		etf_rv: 0
	};
	const months: TaxMonth[] = [];
	let accrued = 0;

	for (const monthKey of monthKeys) {
		const buckets: Partial<Record<ApuravelBucket, BucketMonth>> = {};
		let taxDue = 0;
		for (const bucket of Object.keys(BUCKET_RATES) as ApuravelBucket[]) {
			const monthSales = (salesByMonth.get(monthKey) ?? []).filter(
				(s) => s.bucket === bucket
			);
			if (monthSales.length === 0) continue;
			const bucketMonth = computeBucketMonth(bucket, monthSales, losses);
			taxDue += bucketMonth.tax;
			buckets[bucket] = bucketMonth;
		}

		accrued += taxDue;
		const darfAmount = accrued >= DARF_MINIMUM ? accrued : 0;
		const carriedIntoNext = darfAmount > 0 ? 0 : accrued;
		if (darfAmount > 0) accrued = 0;

		months.push({
			month: monthKey,
			buckets,
			taxDue,
			darfAmount,
			carriedIntoNext,
			dueDate: darfDueDate(monthKey)
		});
	}

	return { months, costs, carryforwardLosses: losses };
}

function computeBucketMonth(
	bucket: ApuravelBucket,
	monthSales: { sale: RealizedSale }[],
	losses: Record<ApuravelBucket, number>
): BucketMonth {
	const grossSales = monthSales.reduce((sum, s) => sum + s.sale.saleValue, 0);
	const gain = monthSales.reduce((sum, s) => sum + s.sale.gain, 0);
	const exempt = bucket === 'acoes' && grossSales <= ACOES_EXEMPTION_LIMIT;

	if (gain < 0) {
		// Losses always accumulate, even in exempt months.
		losses[bucket] += -gain;
		return { grossSales, gain, lossOffset: 0, taxableGain: 0, tax: 0, exempt };
	}
	if (exempt) {
		// Exempt gain: no tax, and prior losses are NOT consumed.
		return { grossSales, gain, lossOffset: 0, taxableGain: 0, tax: 0, exempt };
	}
	const lossOffset = Math.min(losses[bucket], gain);
	losses[bucket] -= lossOffset;
	const taxableGain = gain - lossOffset;
	return {
		grossSales,
		gain,
		lossOffset,
		taxableGain,
		tax: taxableGain * BUCKET_RATES[bucket],
		exempt
	};
}

// ---------------------------------------------------------------------------
// DARF due date: last business day of the month following the apuração month,
// skipping weekends and Brazilian national holidays.
// ---------------------------------------------------------------------------

// Anonymous Gregorian computus.
function easterSunday(year: number): Date {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const d = Math.floor(b / 4);
	const e = b % 4;
	const f = Math.floor((b + 8) / 25);
	const g = Math.floor((b - f + 1) / 3);
	const h = (19 * a + b - d - g + 15) % 30;
	const i = Math.floor(c / 4);
	const k = c % 4;
	const l = (32 + 2 * e + 2 * i - h - k) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const monthNumber = Math.floor((h + l - 7 * m + 114) / 31);
	const day = ((h + l - 7 * m + 114) % 31) + 1;
	return new Date(Date.UTC(year, monthNumber - 1, day));
}

function iso(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
	const copy = new Date(date);
	copy.setUTCDate(copy.getUTCDate() + days);
	return copy;
}

export function nationalHolidays(year: number): Set<string> {
	const easter = easterSunday(year);
	const fixed = [
		`${year}-01-01`, // Confraternização
		`${year}-04-21`, // Tiradentes
		`${year}-05-01`, // Trabalho
		`${year}-09-07`, // Independência
		`${year}-10-12`, // N. Sra. Aparecida
		`${year}-11-02`, // Finados
		`${year}-11-15`, // Proclamação da República
		`${year}-11-20`, // Consciência Negra (feriado nacional desde 2024)
		`${year}-12-25` // Natal
	];
	const movable = [
		iso(addDays(easter, -48)), // Carnaval (segunda)
		iso(addDays(easter, -47)), // Carnaval (terça)
		iso(addDays(easter, -2)), // Sexta-feira Santa
		iso(addDays(easter, 60)) // Corpus Christi
	];
	return new Set([...fixed, ...movable]);
}

export function isBusinessDay(dateIso: string): boolean {
	const date = new Date(`${dateIso}T00:00:00Z`);
	const weekday = date.getUTCDay();
	if (weekday === 0 || weekday === 6) return false;
	return !nationalHolidays(date.getUTCFullYear()).has(dateIso);
}

// apuração month "YYYY-MM" → last business day of the following month.
export function darfDueDate(apuracaoMonth: string): string {
	const [year, monthNumber] = apuracaoMonth.split('-').map(Number);
	// Day 0 of month+2 = last calendar day of month+1.
	let date = new Date(Date.UTC(year, monthNumber + 1, 0));
	while (!isBusinessDay(iso(date))) date = addDays(date, -1);
	return iso(date);
}
