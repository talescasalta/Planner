import { describe, expect, it } from 'vitest';
import { buildImportDedupKey, parseAmount, parseCsvBuffer, stripInstallmentMarker } from './csv-parser';

describe('stripInstallmentMarker', () => {
	it('strips trailing k/n markers so patterns match sibling installments', () => {
		expect(stripInstallmentMarker('MAGAZINE LUIZA 3/5')).toBe('MAGAZINE LUIZA');
		expect(stripInstallmentMarker('MAGAZINE LUIZA - 3/5')).toBe('MAGAZINE LUIZA');
		expect(stripInstallmentMarker('LOJA PARCELA 2/10')).toBe('LOJA');
		expect(stripInstallmentMarker('LOJA PARC. 2 DE 10')).toBe('LOJA');
	});

	it('keeps descriptions without markers untouched', () => {
		expect(stripInstallmentMarker('IFOOD RESTAURANTE')).toBe('IFOOD RESTAURANTE');
		expect(stripInstallmentMarker('POSTO 24/7 LTDA')).toBe('POSTO 24/7 LTDA');
	});
});

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

describe('statement cleanup', () => {
	const nubankBankMapping = {
		dateColumn: 'Data',
		descriptionColumn: 'Descrição',
		amountColumn: 'Valor',
		identifierColumn: 'Identificador',
		currency: 'BRL'
	};

	function bufferOf(csv: string): Buffer {
		return Buffer.from(csv, 'utf-8');
	}

	it('cleans verbose Pix descriptions before classification and deduplication', () => {
		const csv = [
			'Data,Valor,Identificador,Descrição',
			'01/05/2026,-416.27,abc,Transferência enviada pelo Pix - AGORA SOU MAE - 16.624.250/0001-32 - PAGSEGURO INTERNET IP S.A. (0290) Agência: 1 Conta: 5832849-3',
			'02/05/2026,240.00,def,Transferência recebida pelo Pix - GLORIA MENZ FERREIRA - •••.632.580-•• - BCO DO BRASIL S.A. (0001) Agência: 1899 Conta: 24544-5',
			'08/05/2026,-4470.01,ghi,Pagamento de boleto efetuado - GRPQA',
			'09/05/2026,-2.00,jkl,Compra no débito - IFD*Gilceia Caetano De'
		].join('\n');

		const rows = parseCsvBuffer(bufferOf(csv), nubankBankMapping, { sourceType: 'bank_account' });

		expect(rows.map((r) => r.clean_description)).toEqual([
			'PIX ENVIADO - AGORA SOU MAE',
			'PIX RECEBIDO - GLORIA MENZ FERREIRA',
			'BOLETO - GRPQA',
			'DEBITO - IFD*GILCEIA CAETANO DE'
		]);
	});

	it('removes same-identifier debit/credit pairs that cancel each other out', () => {
		const csv = [
			'Data,Valor,Identificador,Descrição',
			'11/05/2026,4029.54,same-id,Compra de ETF - HYBR11',
			'11/05/2026,-4029.54,same-id,Compra de ETF - HYBR11',
			'13/05/2026,212.50,other-id,Crédito em conta'
		].join('\n');

		const rows = parseCsvBuffer(bufferOf(csv), nubankBankMapping, { sourceType: 'bank_account' });

		expect(rows).toHaveLength(1);
		expect(rows[0].description).toBe('Crédito em conta');
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
