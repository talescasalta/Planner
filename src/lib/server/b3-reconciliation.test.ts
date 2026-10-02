import { describe, expect, it } from 'vitest';
import {
	isGenericBankCredit,
	pickInvestmentIncomeCategory,
	reconcileCredit,
	type B3Event
} from './b3-reconciliation';

function event(
	event_date: string,
	event_type: string,
	total_value: number | null,
	overrides: Partial<B3Event> = {}
): B3Event {
	return {
		event_date,
		event_type,
		direction: 'credit',
		total_value,
		source: 'b3_movimentacao',
		...overrides
	};
}

// B3 movimentação of July 2026, as imported.
const JULY = [
	event('2026-07-07', 'Rendimento', 86.4),
	event('2026-07-07', 'Rendimento', 292.9),
	event('2026-07-07', 'Rendimento', 198),
	event('2026-07-07', 'Amortização', 468),
	event('2026-07-08', 'Atualização', null),
	event('2026-07-13', 'Rendimento', 113),
	event('2026-07-13', 'Rendimento', 105.6),
	event('2026-07-13', 'Rendimento', 212.5),
	event('2026-07-14', 'Rendimento', 40),
	event('2026-07-21', 'Rendimento', 44.2)
];

describe('reconcileCredit', () => {
	it('matches a deposit that equals the payments of one day', () => {
		expect(
			reconcileCredit({ date: '2026-07-08', amount: 1045.3 }, JULY)
		).toEqual({ kind: 'investment_income', eventDate: '2026-07-07', count: 4 });
	});

	it('matches a deposit that bundles two consecutive payment dates', () => {
		// 113 + 105.60 + 212.50 (13th) + 40 (14th), deposited on the 16th.
		expect(
			reconcileCredit({ date: '2026-07-16', amount: 471.1 }, JULY)
		).toEqual({ kind: 'investment_income', eventDate: '2026-07-14', count: 4 });
	});

	it('matches a single payment', () => {
		expect(
			reconcileCredit({ date: '2026-07-22', amount: 44.2 }, JULY)
		).toMatchObject({ kind: 'investment_income', eventDate: '2026-07-21' });
	});

	it('matches the September deposit that bundled four payment dates', () => {
		const september = [
			event('2026-09-08', 'Rendimento', 202),
			event('2026-09-08', 'Rendimento', 125.4),
			event('2026-09-08', 'Amortização', 468),
			event('2026-09-08', 'Rendimento', 81.6),
			event('2026-09-11', 'Rendimento', 200),
			event('2026-09-14', 'Rendimento', 110.4),
			event('2026-09-14', 'Rendimento', 85),
			event('2026-09-15', 'Rendimento', 475),
			event('2026-09-15', 'Rendimento', 40)
		];

		expect(
			reconcileCredit({ date: '2026-09-16', amount: 1787.4 }, september)
		).toEqual({ kind: 'investment_income', eventDate: '2026-09-15', count: 9 });
	});

	it('tolerates one cent of rounding and nothing more', () => {
		expect(
			reconcileCredit({ date: '2026-07-22', amount: 44.21 }, JULY)?.kind
		).toBe('investment_income');
		expect(
			reconcileCredit({ date: '2026-07-22', amount: 44.23 }, JULY)
		).toBeNull();
	});

	it('does not match payments more than ten days back or later than the deposit', () => {
		expect(
			reconcileCredit({ date: '2026-08-05', amount: 44.2 }, JULY)
		).toBeNull();
		expect(
			reconcileCredit({ date: '2026-07-20', amount: 44.2 }, JULY)
		).toBeNull();
	});

	it('returns nothing for an amount with no matching payments', () => {
		expect(
			reconcileCredit({ date: '2026-07-16', amount: 0.14 }, JULY)
		).toBeNull();
		expect(
			reconcileCredit({ date: '2026-07-16', amount: 471.1 }, [])
		).toBeNull();
	});

	it('ignores events that are not income credits', () => {
		const notIncome = [
			event('2026-07-14', 'Rendimento', 471.1, { direction: 'debit' }),
			event('2026-07-14', 'Rendimento', 471.1, { source: 'b3_negociacao' }),
			event('2026-07-14', 'Compra', 471.1)
		];

		expect(
			reconcileCredit({ date: '2026-07-16', amount: 471.1 }, notIncome)
		).toBeNull();
	});

	it('flags a large deposit right after a redemption instead of calling it income', () => {
		// 31,536.24 on Aug 19: Tesouro redeemed on the 17th plus its coupons.
		const august = [
			event('2026-08-14', 'RESGATE ANTECIPADO', null, { direction: 'debit' }),
			event('2026-08-17', 'Juros', 1374.06),
			event('2026-08-17', 'Juros', 393.99),
			event('2026-08-17', 'Juros', 2298.04),
			event('2026-08-17', 'Resgate', 29594.7, { direction: 'debit' })
		];

		expect(
			reconcileCredit({ date: '2026-08-19', amount: 31536.24 }, august)
		).toEqual({ kind: 'redemption_likely' });
	});

	it('does not call a small deposit or an old redemption a redemption', () => {
		const redemption = [
			event('2026-08-17', 'Resgate', 500, { direction: 'debit' })
		];

		expect(
			reconcileCredit({ date: '2026-08-19', amount: 900 }, redemption)
		).toBeNull();
		expect(
			reconcileCredit({ date: '2026-08-30', amount: 31536.24 }, redemption)
		).toBeNull();
	});

	it('prefers income over a redemption when the payments add up exactly', () => {
		const mixed = [
			event('2026-08-17', 'Rendimento', 1500),
			event('2026-08-17', 'Resgate', 9000, { direction: 'debit' })
		];

		expect(
			reconcileCredit({ date: '2026-08-18', amount: 1500 }, mixed)?.kind
		).toBe('investment_income');
	});
});

describe('isGenericBankCredit', () => {
	it('matches the bare Nubank deposit label only', () => {
		expect(isGenericBankCredit('Crédito em conta')).toBe(true);
		expect(isGenericBankCredit('CREDITO EM CONTA')).toBe(true);
		expect(
			isGenericBankCredit('Transferência Recebida - NU ASSET MANAGEMENT LTDA')
		).toBe(false);
		expect(isGenericBankCredit('SISPAG CARE PLUS')).toBe(false);
	});
});

describe('pickInvestmentIncomeCategory', () => {
	const renda = { id: 'renda', name: 'Renda', parent_id: null };
	const proventos = {
		id: 'proventos',
		name: 'Investimentos',
		parent_id: 'renda',
		financial_treatment: 'investment_income'
	};

	it('files under the parent with the marked subcategory', () => {
		expect(pickInvestmentIncomeCategory([renda, proventos])).toEqual({
			category_id: 'renda',
			subcategory_id: 'proventos'
		});
	});

	it('uses a marked top-level category when there is no subcategory', () => {
		expect(
			pickInvestmentIncomeCategory([
				{ ...renda, financial_treatment: 'investment_income' }
			])
		).toEqual({ category_id: 'renda', subcategory_id: null });
	});

	it('prefers a subcategory and returns nothing when none is marked', () => {
		expect(
			pickInvestmentIncomeCategory([
				{
					id: 'top',
					name: 'Proventos',
					parent_id: null,
					financial_treatment: 'investment_income'
				},
				proventos
			])?.subcategory_id
		).toBe('proventos');
		expect(pickInvestmentIncomeCategory([renda])).toBeNull();
	});
});
