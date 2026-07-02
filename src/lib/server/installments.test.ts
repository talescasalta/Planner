import { describe, expect, it } from 'vitest';
import { parseInstallment, installmentGroupKey } from './csv-parser';
import { addMonths, projectFutureInstallments, type InstallmentSourceTransaction } from './installments';

describe('parseInstallment', () => {
	it('reads the "Parcela k/n" keyword form', () => {
		expect(parseInstallment('LOJA X - Parcela 1/6')).toEqual({ number: 1, total: 6 });
		expect(parseInstallment('Farmácia Parc 04/08')).toEqual({ number: 4, total: 8 });
	});

	it('reads a bare trailing k/n marker', () => {
		expect(parseInstallment('MAGAZINE LUIZA 3/10')).toEqual({ number: 3, total: 10 });
	});

	it('reads the "k de n" form', () => {
		expect(parseInstallment('Movelaria 2 de 5')).toEqual({ number: 2, total: 5 });
	});

	it('ignores non-installment descriptions', () => {
		expect(parseInstallment('Mercado Central')).toBeNull();
		expect(parseInstallment('PIX ENVIADO - FULANO')).toBeNull();
	});

	it('rejects impossible ranges (k > n) so dates are not misread', () => {
		expect(parseInstallment('COMPRA 12/06')).toBeNull();
	});
});

describe('installmentGroupKey', () => {
	it('ties installments of the same purchase across months', () => {
		const first = installmentGroupKey('LOJA X - PARCELA 1/6', -50, 6);
		const second = installmentGroupKey('LOJA X - PARCELA 2/6', -50, 6);
		expect(first).toBe(second);
		expect(first).toBe('LOJA X|6|50.00');
	});

	it('separates purchases with different totals or amounts', () => {
		expect(installmentGroupKey('LOJA X 1/6', -50, 6)).not.toBe(
			installmentGroupKey('LOJA X 1/12', -50, 12)
		);
	});
});

describe('addMonths', () => {
	it('rolls over year boundaries', () => {
		expect(addMonths('2026-11', 3)).toBe('2027-02');
		expect(addMonths('2026-01', -2)).toBe('2025-11');
	});
});

describe('projectFutureInstallments', () => {
	function tx(overrides: Partial<InstallmentSourceTransaction>): InstallmentSourceTransaction {
		return {
			installment_number: null,
			installment_total: null,
			installment_group_key: null,
			amount: 0,
			reference_month: null,
			date: '2026-06-15',
			clean_description: null,
			description: '',
			category_display_name: null,
			...overrides
		};
	}

	it('projects the remaining installments into following months', () => {
		const result = projectFutureInstallments([
			tx({
				installment_number: 1,
				installment_total: 3,
				installment_group_key: 'LOJA X|3|100.00',
				amount: -100,
				reference_month: '2026-06',
				clean_description: 'LOJA X'
			})
		]);

		expect(result.count).toBe(2);
		expect(result.total).toBeCloseTo(-200);
		expect(result.months.map((m) => m.month)).toEqual(['2026-07', '2026-08']);
		expect(result.months[0].items[0]).toMatchObject({ number: 2, total: 3, amount: -100 });
	});

	it('anchors on the latest known installment so already-imported months are not re-projected', () => {
		const result = projectFutureInstallments([
			tx({
				installment_number: 1,
				installment_total: 4,
				installment_group_key: 'LOJA Y|4|30.00',
				amount: -30,
				reference_month: '2026-06',
				clean_description: 'LOJA Y'
			}),
			tx({
				installment_number: 2,
				installment_total: 4,
				installment_group_key: 'LOJA Y|4|30.00',
				amount: -30,
				reference_month: '2026-07',
				clean_description: 'LOJA Y'
			})
		]);

		// Only installments 3 and 4 remain, in Aug and Sep.
		expect(result.count).toBe(2);
		expect(result.months.map((m) => m.month)).toEqual(['2026-08', '2026-09']);
	});

	it('projects nothing when the purchase is fully paid', () => {
		const result = projectFutureInstallments([
			tx({
				installment_number: 6,
				installment_total: 6,
				installment_group_key: 'LOJA Z|6|10.00',
				amount: -10,
				reference_month: '2026-06'
			})
		]);
		expect(result.count).toBe(0);
		expect(result.months).toEqual([]);
	});

	it('aggregates installments from different purchases into the same month', () => {
		const result = projectFutureInstallments([
			tx({
				installment_number: 1,
				installment_total: 2,
				installment_group_key: 'A|2|100.00',
				amount: -100,
				reference_month: '2026-06',
				clean_description: 'A'
			}),
			tx({
				installment_number: 1,
				installment_total: 2,
				installment_group_key: 'B|2|40.00',
				amount: -40,
				reference_month: '2026-06',
				clean_description: 'B'
			})
		]);

		expect(result.months).toHaveLength(1);
		expect(result.months[0].month).toBe('2026-07');
		expect(result.months[0].total).toBeCloseTo(-140);
		expect(result.months[0].items).toHaveLength(2);
	});
});
