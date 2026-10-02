// Rules for naming the account of rows imported before the account was
// recorded. Dependency-free on purpose: scripts/backfill-transaction-accounts.mjs
// runs this file directly with Node.

export const ACCOUNT_NAMES = {
	itau: 'Itaú conta',
	nubankAccount: 'Nubank conta',
	nubankCard: 'Nubank cartão',
	foodVoucher: 'Vale alimentação',
	mealVoucher: 'Vale refeição'
} as const;

// Itaú statements print terse debit/credit codes in capitals ("DA COMGAS",
// "REND PAGO APLIC AUT MAIS"); the screenshots of the same app title-case them,
// so matching is case-insensitive.
const ITAU_DESCRIPTION =
	/^(PIX TRANSF|PIX QRS|DA |REND PAGO|SISPAG|DEV PIX|TED |INT |CARE PLUS|CLEUSA|PAY2ALL|SECR\.? DA RECEITA)/i;

const NUBANK_DESCRIPTION =
	/^(Transfer[eê]ncia (enviada|recebida)|Cr[eé]dito em conta|Pagamento de boleto|Compra no d[eé]bito|Resgate|Aplica[cç][aã]o|Compra de ETF|Reembolso recebido|Estorno|Pagamento de fatura|D[eé]bito em conta|Cobran[cç]a de investimentos)/i;

export function accountForTransaction(row: {
	source_type: string | null;
	description: string;
}): string | null {
	switch (row.source_type) {
		case 'credit_card':
			return ACCOUNT_NAMES.nubankCard;
		case 'vale_alimentacao':
			return ACCOUNT_NAMES.foodVoucher;
		case 'vale_refeicao':
			return ACCOUNT_NAMES.mealVoucher;
		case 'bank_account':
			if (ITAU_DESCRIPTION.test(row.description)) return ACCOUNT_NAMES.itau;
			if (NUBANK_DESCRIPTION.test(row.description)) {
				return ACCOUNT_NAMES.nubankAccount;
			}
			return null;
		default:
			return null;
	}
}

// Screenshots and pasted text carry no account in their name.
export function accountForImportFilename(filename: string): string | null {
	if (/^NU_/i.test(filename)) return ACCOUNT_NAMES.nubankAccount;
	if (/^Nubank_/i.test(filename)) return ACCOUNT_NAMES.nubankCard;
	if (/^itau_/i.test(filename)) return ACCOUNT_NAMES.itau;
	return null;
}
