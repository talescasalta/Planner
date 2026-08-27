import { describe, expect, it } from 'vitest';
import {
	buildTradeLots,
	computeCostBasis,
	computeTaxReport,
	darfDueDate,
	isBusinessDay,
	type TaxAssetRow
} from './investment-tax';
import type { EventRow } from './investment-positions';

function event(partial: Partial<EventRow>): EventRow {
	return {
		asset_id: 'a1',
		event_date: '2026-01-10',
		event_type: 'Compra',
		direction: 'credit',
		quantity: null,
		unit_price: null,
		total_value: null,
		source: 'b3_negociacao',
		...partial
	};
}

function asset(partial: Partial<TaxAssetRow> = {}): TaxAssetRow {
	return {
		id: 'a1',
		tax_bucket: 'fii',
		override_quantity: null,
		override_total_cost: null,
		override_date: null,
		...partial
	};
}

describe('buildTradeLots', () => {
	it('prefers negociação and drops settlement rows of the same month', () => {
		const lots = buildTradeLots([
			event({ event_date: '2026-01-10', quantity: 100, total_value: 1000 }),
			event({
				event_date: '2026-01-12',
				event_type: 'Transferência - Liquidação',
				quantity: 100,
				total_value: 1000,
				source: 'b3_movimentacao'
			})
		]);
		expect(lots).toHaveLength(1);
		expect(lots[0].kind).toBe('buy');
	});

	it('falls back to settlements in months without negociação rows', () => {
		const lots = buildTradeLots([
			event({ event_date: '2026-01-10', quantity: 100, total_value: 1000 }),
			event({
				event_date: '2026-02-12',
				event_type: 'Transferência - Liquidação',
				quantity: 50,
				total_value: 600,
				source: 'b3_movimentacao'
			})
		]);
		expect(lots).toHaveLength(2);
		expect(lots[1]).toMatchObject({ kind: 'buy', quantity: 50, value: 600 });
	});
});

describe('computeCostBasis', () => {
	it('computes weighted average across buys and realizes gains on sells', () => {
		const { cost, sales } = computeCostBasis(asset(), [
			event({ event_date: '2026-01-10', quantity: 100, total_value: 1000 }), // avg 10
			event({ event_date: '2026-02-10', quantity: 100, total_value: 2000 }), // avg 15
			event({
				event_date: '2026-03-10',
				direction: 'debit',
				event_type: 'Venda',
				quantity: 50,
				total_value: 1000
			})
		]);
		expect(sales).toHaveLength(1);
		expect(sales[0].costBasis).toBeCloseTo(750); // 50 × 15
		expect(sales[0].gain).toBeCloseTo(250);
		expect(cost.quantity).toBe(150);
		expect(cost.averageCost).toBeCloseTo(15);
	});

	it('seeds from the manual override for pre-history holdings', () => {
		const { cost } = computeCostBasis(
			asset({
				override_quantity: 100,
				override_total_cost: 800,
				override_date: '2020-01-01'
			}),
			[]
		);
		expect(cost.averageCost).toBeCloseTo(8);
	});

	it('FII amortization reduces basis without touching quantity', () => {
		const { cost } = computeCostBasis(asset(), [
			event({ event_date: '2026-01-10', quantity: 100, total_value: 1000 }),
			event({
				event_date: '2026-02-10',
				event_type: 'Amortização',
				total_value: 200,
				source: 'b3_movimentacao'
			})
		]);
		expect(cost.quantity).toBe(100);
		expect(cost.totalCost).toBeCloseTo(800);
	});

	it('exercised subscriptions add quantity and cost; bonuses add at zero cost', () => {
		const { cost } = computeCostBasis(asset(), [
			event({ event_date: '2026-01-10', quantity: 100, total_value: 1000 }),
			event({
				event_date: '2026-02-10',
				event_type: 'Direito de Subscrição',
				quantity: 10,
				total_value: 90,
				source: 'b3_movimentacao'
			}),
			event({
				event_date: '2026-03-10',
				event_type: 'Bonificação em Ativos',
				quantity: 10,
				total_value: null,
				source: 'b3_movimentacao'
			})
		]);
		expect(cost.quantity).toBe(120);
		expect(cost.totalCost).toBeCloseTo(1090);
	});
});

describe('computeTaxReport', () => {
	it('taxes FII gains at 20% with no exemption', () => {
		const report = computeTaxReport(
			[asset()],
			[
				event({ event_date: '2026-01-10', quantity: 100, total_value: 10000 }),
				event({
					event_date: '2026-02-10',
					direction: 'debit',
					event_type: 'Venda',
					quantity: 100,
					total_value: 11000
				})
			]
		);
		expect(report.months).toHaveLength(1);
		const fii = report.months[0].buckets.fii!;
		expect(fii.gain).toBeCloseTo(1000);
		expect(fii.tax).toBeCloseTo(200);
	});

	it('exempts ações gains when monthly gross sales stay under R$20k, keeping losses', () => {
		const buy = event({
			event_date: '2026-01-05',
			quantity: 100,
			total_value: 10000
		});
		const smallSale = event({
			event_date: '2026-02-10',
			direction: 'debit',
			event_type: 'Venda',
			quantity: 50,
			total_value: 6000
		});
		const report = computeTaxReport(
			[asset({ tax_bucket: 'acoes' })],
			[buy, smallSale]
		);
		const acoes = report.months[0].buckets.acoes!;
		expect(acoes.exempt).toBe(true);
		expect(acoes.gain).toBeCloseTo(1000);
		expect(acoes.tax).toBe(0);
	});

	it('taxes ações fully at 15% above the R$20k boundary (not just the excess)', () => {
		const report = computeTaxReport(
			[asset({ tax_bucket: 'acoes' })],
			[
				event({ event_date: '2026-01-05', quantity: 1000, total_value: 20000 }), // avg 20
				event({
					event_date: '2026-02-10',
					direction: 'debit',
					event_type: 'Venda',
					quantity: 1000,
					total_value: 25000
				})
			]
		);
		const acoes = report.months[0].buckets.acoes!;
		expect(acoes.exempt).toBe(false);
		expect(acoes.taxableGain).toBeCloseTo(5000);
		expect(acoes.tax).toBeCloseTo(750);
	});

	it('carries losses forward within the same bucket only', () => {
		const fiiLossThenGain = [
			event({
				asset_id: 'f1',
				event_date: '2026-01-05',
				quantity: 100,
				total_value: 10000
			}),
			event({
				asset_id: 'f1',
				event_date: '2026-02-10',
				direction: 'debit',
				event_type: 'Venda',
				quantity: 50,
				total_value: 4000
			}), // loss 1000
			event({
				asset_id: 'f1',
				event_date: '2026-03-10',
				direction: 'debit',
				event_type: 'Venda',
				quantity: 50,
				total_value: 5600
			}) // gain 600
		];
		const etfGain = [
			event({
				asset_id: 'e1',
				event_date: '2026-01-05',
				quantity: 10,
				total_value: 1000
			}),
			event({
				asset_id: 'e1',
				event_date: '2026-03-12',
				direction: 'debit',
				event_type: 'Venda',
				quantity: 10,
				total_value: 1400
			})
		];
		const report = computeTaxReport(
			[asset({ id: 'f1' }), asset({ id: 'e1', tax_bucket: 'etf_rv' })],
			[...fiiLossThenGain, ...etfGain]
		);
		const march = report.months.find((m) => m.month === '2026-03')!;
		// FII gain of 600 fully absorbed by the 1000 carried loss → no tax.
		expect(march.buckets.fii!.lossOffset).toBeCloseTo(600);
		expect(march.buckets.fii!.tax).toBe(0);
		// ETF gain untouched by FII losses: 400 × 15%.
		expect(march.buckets.etf_rv!.tax).toBeCloseTo(60);
		expect(report.carryforwardLosses.fii).toBeCloseTo(400);
	});

	it('accrues sub-R$10 DARFs until the accumulated amount crosses the minimum', () => {
		// Two months with tiny gains: 30 gain → 6 tax (<10, accrues), then
		// 40 gain → 8 tax, accumulated 14 ≥ 10 → payable.
		const report = computeTaxReport(
			[asset()],
			[
				event({ event_date: '2026-01-05', quantity: 100, total_value: 10000 }),
				event({
					event_date: '2026-02-10',
					direction: 'debit',
					event_type: 'Venda',
					quantity: 10,
					total_value: 1030
				}),
				event({
					event_date: '2026-03-10',
					direction: 'debit',
					event_type: 'Venda',
					quantity: 10,
					total_value: 1040
				})
			]
		);
		const [feb, mar] = report.months;
		expect(feb.taxDue).toBeCloseTo(6);
		expect(feb.darfAmount).toBe(0);
		expect(feb.carriedIntoNext).toBeCloseTo(6);
		expect(mar.taxDue).toBeCloseTo(8);
		expect(mar.darfAmount).toBeCloseTo(14);
	});

	it('never taxes retido_fonte or isento buckets', () => {
		const report = computeTaxReport(
			[asset({ tax_bucket: 'retido_fonte' })],
			[
				event({ event_date: '2026-01-05', quantity: 100, total_value: 1000 }),
				event({
					event_date: '2026-02-10',
					direction: 'debit',
					event_type: 'Venda',
					quantity: 100,
					total_value: 5000
				})
			]
		);
		expect(report.months).toHaveLength(0);
	});
});

describe('DARF due dates (table-driven against known calendars)', () => {
	it('handles ordinary month ends', () => {
		// Apuração jan/2026 → último dia útil de fev/2026 = 27/02 (sábado 28).
		expect(darfDueDate('2026-01')).toBe('2026-02-27');
	});

	it('skips weekends and holidays at month end', () => {
		// Apuração out/2026 → 30/11/2026 é segunda-feira útil.
		expect(darfDueDate('2026-10')).toBe('2026-11-30');
		// Apuração nov/2026 → 31/12/2026 é quinta útil.
		expect(darfDueDate('2026-11')).toBe('2026-12-31');
	});

	it('rolls over year boundaries', () => {
		// Apuração dez/2026 → último dia útil de jan/2027 = 29/01/2027 (sexta).
		expect(darfDueDate('2026-12')).toBe('2027-01-29');
	});

	it('knows the Brazilian holiday calendar', () => {
		expect(isBusinessDay('2026-04-03')).toBe(false); // Sexta-feira Santa 2026
		expect(isBusinessDay('2026-02-17')).toBe(false); // Carnaval 2026 (terça)
		expect(isBusinessDay('2026-06-04')).toBe(false); // Corpus Christi 2026
		expect(isBusinessDay('2026-11-20')).toBe(false); // Consciência Negra
		expect(isBusinessDay('2026-08-27')).toBe(true); // quinta comum
	});
});
