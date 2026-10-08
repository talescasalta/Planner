import { describe, expect, it } from 'vitest';
import {
	ACCOUNT_NAMES,
	accountForImportFilename,
	accountForTransaction
} from './account-backfill';

const bank = (description: string) =>
	accountForTransaction({ source_type: 'bank_account', description });

describe('accountForTransaction', () => {
	it('names the account from the source type for cards and vouchers', () => {
		const row = (source_type: string) =>
			accountForTransaction({ source_type, description: 'qualquer' });

		expect(row('credit_card')).toBe(ACCOUNT_NAMES.nubankCard);
		expect(row('vale_alimentacao')).toBe(ACCOUNT_NAMES.foodVoucher);
		expect(row('vale_refeicao')).toBe(ACCOUNT_NAMES.mealVoucher);
	});

	it('recognizes Itaú statement lines in capitals and title case', () => {
		for (const description of [
			'PIX TRANSF JOANA 29/09',
			'DA COMGAS 11111111',
			'REND PAGO APLIC AUT MAIS',
			'Rend Pago Aplic Aut Mais',
			'SISPAG CARE PLUS',
			'Care Plus Medicina Assistencial Lt...',
			'Da Vivo p-33333333000',
			'DEV PIX ENJOEI16/09',
			'PIX TRANSF SECR. D30/06',
			'Secr. Da Receita Federal - Lote 202...',
			'Pay2all Instituicao De Pagamento ...'
		]) {
			expect(bank(description), description).toBe(ACCOUNT_NAMES.itau);
		}
	});

	it('recognizes Nubank account lines', () => {
		for (const description of [
			'Transferência enviada pelo Pix - Maria Silva - •••.123.456-••',
			'Transferência Recebida - NU ASSET MANAGEMENT LTDA',
			'Crédito em conta',
			'Pagamento de boleto efetuado - COND EDIF EXEMPLO',
			'Compra de ETF - HGBR11',
			'Cobrança de investimentos - Tesouro',
			'Reembolso recebido pelo Pix - RE PETIT'
		]) {
			expect(bank(description), description).toBe(ACCOUNT_NAMES.nubankAccount);
		}
	});

	it('leaves bank rows it cannot place without an account', () => {
		expect(bank('Algo sem padrão conhecido')).toBeNull();
		expect(
			accountForTransaction({ source_type: null, description: 'PIX TRANSF X' })
		).toBeNull();
	});
});

describe('accountForImportFilename', () => {
	it('maps the export names the banks use', () => {
		expect(
			accountForImportFilename('NU_21444856_01SET2026_30SET2026.csv')
		).toBe(ACCOUNT_NAMES.nubankAccount);
		expect(accountForImportFilename('Nubank_2026-06-03.csv')).toBe(
			ACCOUNT_NAMES.nubankCard
		);
		expect(accountForImportFilename('itau_extrato_092026.pdf')).toBe(
			ACCOUNT_NAMES.itau
		);
	});

	it('does not guess for screenshots and pasted text', () => {
		expect(
			accountForImportFilename('Screenshot_20261001_233622.jpg')
		).toBeNull();
		expect(accountForImportFilename('texto-colado.csv')).toBeNull();
	});
});
