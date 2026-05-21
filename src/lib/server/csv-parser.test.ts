import { describe, expect, it } from 'vitest';
import { buildImportDedupKey, parseAmount, parseCsvBuffer } from './csv-parser';

describe('buildImportDedupKey', () => {
	it('normalizes description whitespace, amount precision, and currency', () => {
		const key = buildImportDedupKey({
			date: '2026-04-01',
			clean_description: '  mercado   central  ',
			amount: 10.5,
			currency: 'BRL'
		});

		expect(key).toBe('2026-04-01|MERCADO CENTRAL|10.50|BRL');
	});
});

describe('parseCsvBuffer credit card payment filter', () => {
	const mapping = {
		dateColumn: 'date',
		descriptionColumn: 'title',
		amountColumn: 'amount',
		currency: 'BRL'
	};

	function bufferOf(csv: string): Buffer {
		return Buffer.from(csv, 'utf-8');
	}

	it('drops the bill payment row but keeps refunds when source is credit_card', () => {
		const csv = [
			'date,title,amount',
			'2026-04-01,Mercado Central,100.00',
			'2026-04-10,Pagamento recebido,-500.00',
			'2026-04-15,Estorno de Loja XYZ,-30.00'
		].join('\n');

		const rows = parseCsvBuffer(bufferOf(csv), mapping, { sourceType: 'credit_card' });

		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.description)).toEqual(['Mercado Central', 'Estorno de Loja XYZ']);
		// charge flipped to negative, refund flipped to positive
		expect(rows[0].amount).toBe(-100);
		expect(rows[1].amount).toBe(30);
	});

	it('does not drop payment rows when source is bank_account', () => {
		const csv = ['date,title,amount', '2026-04-10,Pagamento de boleto,-500.00'].join('\n');
		const rows = parseCsvBuffer(bufferOf(csv), mapping, { sourceType: 'bank_account' });
		expect(rows).toHaveLength(1);
		expect(rows[0].amount).toBe(-500);
	});

	it('parses Brazilian currency values and dash-separated dates', () => {
		const csv = ['date,title,amount', '01-04-2026,Mercado Central,"R$ 1.234,56"'].join('\n');
		const rows = parseCsvBuffer(bufferOf(csv), mapping, { sourceType: 'bank_account' });

		expect(rows).toHaveLength(1);
		expect(rows[0].date).toBe('2026-04-01');
		expect(rows[0].amount).toBe(1234.56);
	});
});

describe('parseAmount', () => {
	it('supports common decimal and thousands separators', () => {
		expect(parseAmount('1,23')).toBe(1.23);
		expect(parseAmount('1.23')).toBe(1.23);
		expect(parseAmount('1.234,56')).toBe(1234.56);
		expect(parseAmount('1,234.56')).toBe(1234.56);
		expect(parseAmount('R$ -1.234,56')).toBe(-1234.56);
	});
});
