import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';

vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import { parseWiseStatement } from './wise-statement';

// Shape of the CSV Wise exports (Extratos → CSV). Values are fictitious.
const HEADER =
	'"TransferWise ID",Date,"Date Time",Amount,Currency,Description,"Payment Reference","Running Balance","Exchange From","Exchange To","Exchange Rate","Payer Name","Payee Name","Payee Account Number",Merchant,"Card Last Four Digits","Card Holder Full Name",Attachment,Note,"Total fees","Exchange To Amount","Transaction Type","Transaction Details Type","Asset Base Currency Unit Price Amount-0","Asset Base Currency Unit Price Currency-0","Effective trade rate-0","Settlement Currency Unit Price Amount-0","Settlement Currency Unit Price Currency-0","Trade Side-0","Traded Asset Id Type-0","Traded Asset Id Value-0","Traded Units-0"';
const BRL_HEADER = HEADER.split(',"Asset Base')[0];

const ISIN = 'IE00B45H7020';

function trade(
	id: string,
	date: string,
	side: string,
	price: string,
	units: string,
	currency = 'USD'
) {
	return `"BALANCE_INVESTMENTS-${id}",${date},"${date} 10:00:00.000",0.00,${currency},"Rende+",,1000.00,,,,,,,,,,,,0.00,,CREDIT,INVESTMENT_TRADE_ORDER,${price},${currency},1.00000,${price},${currency},${side},ISIN,${ISIN},${units}`;
}

const DEPOSIT =
	'"TRANSFER-1",03-09-2026,"03-09-2026 09:00:00.000",500.00,USD,"Recebido de Corretora X",,1500.00,,,,"Corretora X",,,,,,,,0.00,,CREDIT,DEPOSIT,,,,,,,,,';

const csv = (...rows: string[]) => strToU8([HEADER, ...rows].join('\n'));

describe('parseWiseStatement', () => {
	it('keeps only the Rende+ trades, with quotas and quota price', () => {
		const statement = parseWiseStatement(
			csv(
				trade('a', '01-09-2026', 'BUY', '100.00', '10.5'),
				DEPOSIT,
				trade('b', '04-09-2026', 'SELL', '100.10', '2')
			)
		);
		expect(statement.warnings).toEqual([]);
		expect(statement.trades).toEqual([
			{
				id: 'BALANCE_INVESTMENTS-a',
				date: '2026-09-01',
				side: 'BUY',
				isin: ISIN,
				units: 10.5,
				unitPrice: 100,
				currency: 'USD'
			},
			{
				id: 'BALANCE_INVESTMENTS-b',
				date: '2026-09-04',
				side: 'SELL',
				isin: ISIN,
				units: 2,
				unitPrice: 100.1,
				currency: 'USD'
			}
		]);
	});

	it('reads every CSV of the zip and does not double a repeated trade', () => {
		const zip = zipSync({
			'statement_1_USD.csv': csv(trade('a', '01-09-2026', 'BUY', '100', '1')),
			'statement_2_BRL.csv': strToU8(BRL_HEADER),
			'copy_USD.csv': csv(trade('a', '01-09-2026', 'BUY', '100', '1'))
		});
		expect(parseWiseStatement(zip).trades).toHaveLength(1);
	});

	it('warns about trades it cannot read instead of guessing', () => {
		const statement = parseWiseStatement(
			csv(
				trade('bad', '01-09-2026', 'BUY', '0', '1'),
				trade('chf', '01-09-2026', 'BUY', '100', '1', 'CHF')
			)
		);
		expect(statement.trades).toEqual([]);
		expect(statement.warnings).toEqual([
			'Movimento do Rende+ ilegível ignorado (BALANCE_INVESTMENTS-bad).',
			'Moeda CHF não suportada (BALANCE_INVESTMENTS-chf).'
		]);
	});

	it('accepts a byte-order mark before the header', () => {
		const withBom = strToU8(
			`${String.fromCharCode(0xfeff)}${[HEADER, trade('a', '01-09-2026', 'BUY', '100', '1')].join('\n')}`
		);
		expect(parseWiseStatement(withBom).trades).toHaveLength(1);
	});

	it('refuses a file that is not a Wise statement', () => {
		expect(() =>
			parseWiseStatement(strToU8('Data,Valor\n01/09/2026,10'))
		).toThrow('Não reconheci o extrato da Wise');
	});
});
