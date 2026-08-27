import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { parseB3File, snapshotDateFromFilename } from './investment-import';
import { resolveAssetSpec } from './investment-assets';
import { parseB3Date } from './investment-xlsx';

// Fixtures are anonymized copies of real B3 export rows, keeping the quirks:
// "-" placeholder cells, blank spacer rows, fractional Tesouro quantities and
// the Renda Fixa sheet valuing rows via CURVA instead of Valor Atualizado.

async function buildXlsx(
	sheets: { name: string; rows: (string | number | null)[][] }[]
) {
	const workbook = new ExcelJS.Workbook();
	for (const sheet of sheets) {
		const worksheet = workbook.addWorksheet(sheet.name);
		for (const row of sheet.rows) worksheet.addRow(row);
	}
	return Buffer.from(await workbook.xlsx.writeBuffer());
}

function posicaoFixture() {
	return buildXlsx([
		{
			name: 'ETF',
			rows: [
				[
					'Produto',
					'Instituição',
					'Conta',
					'Código de Negociação',
					'CNPJ do Fundo',
					'Código ISIN / Distribuição',
					'Tipo',
					'Quantidade',
					'Quantidade Disponível',
					'Quantidade Indisponível',
					'Motivo',
					'Preço de Fechamento',
					'Valor Atualizado'
				],
				[
					'BOVA11 - ISHARES IBOVESPA FUNDO DE ÍNDICE',
					'CORRETORA X',
					'123',
					'BOVA11',
					'10406511000161',
					'BRBOVACTF003 - 120',
					'Ações',
					170,
					170,
					'-',
					'-',
					171.82,
					29209.4
				],
				[
					'HYBR11 - ETF RENDA FIXA QUALQUER',
					'CORRETORA X',
					'123',
					'HYBR11',
					'62344693000197',
					'BRHYBRCTF005 - 100',
					'Renda Fixa',
					22,
					22,
					'-',
					'-',
					55.98,
					1231.56
				]
			]
		},
		{
			name: 'Fundo de Investimento',
			rows: [
				[
					'Produto',
					'Instituição',
					'Conta',
					'Código de Negociação',
					'CNPJ do Fundo',
					'Código ISIN / Distribuição',
					'Tipo',
					'Administrador',
					'Quantidade',
					'Quantidade Disponível',
					'Quantidade Indisponível',
					'Motivo',
					'Preço de Fechamento',
					'Valor Atualizado'
				],
				[
					'KNCR11 - KINEA RENDIMENTOS IMOBILIÁRIOS FII',
					'CORRETORA X',
					'123',
					'KNCR11',
					'16706958000132',
					'BRKNCRCTF000 - 268',
					'Cotas',
					'ADMIN S/A',
					96,
					96,
					'-',
					'-',
					107,
					10272
				]
			]
		},
		{
			name: 'Renda Fixa',
			rows: [
				[
					'Produto',
					'Instituição',
					'Emissor',
					'Código',
					'Indexador',
					'Tipo de regime',
					'Data de Emissão',
					'Vencimento',
					'Quantidade',
					'Quantidade Disponível',
					'Quantidade Indisponível',
					'Motivo',
					'Contraparte',
					'Preço Atualizado MTM',
					'Valor Atualizado MTM',
					'Preço Atualizado CURVA',
					'Valor Atualizado CURVA',
					'Preço Atualizado FECHAMENTO',
					'Valor Atualizado FECHAMENTO'
				],
				[
					'LCA - BANCO Y S.A.',
					'BANCO Y S.A.',
					'BANCO Y S.A.',
					'26E04399216',
					'-',
					'REGISTRADO',
					'27/05/2026',
					'28/05/2027',
					15000000,
					15000000,
					'-',
					'-',
					'-',
					'-',
					'-',
					0.0103124,
					154686,
					'-',
					'-'
				],
				[
					'',
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null,
					null
				]
			]
		},
		{
			name: 'Tesouro Direto',
			rows: [
				[
					'Produto',
					'Instituição',
					'Código ISIN',
					'Indexador',
					'Vencimento',
					'Quantidade',
					'Quantidade Disponível',
					'Quantidade Indisponível',
					'Motivo',
					'Valor Aplicado',
					'Valor bruto',
					'Valor líquido',
					'Valor Atualizado'
				],
				[
					'Tesouro IPCA+ 2032',
					'CORRETORA X',
					'BRSTNCNTB7T1',
					'IPCA',
					'15/08/2032',
					3.44,
					3.44,
					0,
					'-',
					9981.98,
					10250.85,
					10186.02,
					10250.85
				]
			]
		}
	]);
}

describe('parseB3File posição', () => {
	it('parses every sheet, skipping blank spacer rows', async () => {
		const parsed = await parseB3File(await posicaoFixture());
		expect(parsed.kind).toBe('posicao');
		expect(parsed.positions).toHaveLength(5);
		expect(parsed.events).toHaveLength(0);
	});

	it('keeps fractional Tesouro quantities and picks the right values', async () => {
		const parsed = await parseB3File(await posicaoFixture());
		const tesouro = parsed.positions.find(
			(p) => p.spec.assetClass === 'tesouro'
		);
		expect(tesouro?.quantity).toBe(3.44);
		expect(tesouro?.netValue).toBe(10250.85);
		expect(tesouro?.appliedValue).toBe(9981.98);
		expect(tesouro?.spec.productKey).toBe('TESOURO:TESOURO IPCA+ 2032');
	});

	it('values Renda Fixa rows via CURVA when MTM is "-" and null-ifies close price', async () => {
		const parsed = await parseB3File(await posicaoFixture());
		const lca = parsed.positions.find((p) => p.spec.assetClass === 'lca_lci');
		expect(lca?.netValue).toBe(154686);
		expect(lca?.closePrice).toBeNull();
		expect(lca?.spec.productKey).toBe('LCA:26E04399216');
		expect(lca?.spec.taxBucket).toBe('isento');
	});

	it('classifies by sheet and splits ETF tax bucket by Tipo', async () => {
		const parsed = await parseB3File(await posicaoFixture());
		const byKey = new Map(
			parsed.positions.map((p) => [p.spec.productKey, p.spec])
		);
		expect(byKey.get('BOVA11')?.assetClass).toBe('etf');
		expect(byKey.get('BOVA11')?.taxBucket).toBe('etf_rv');
		expect(byKey.get('HYBR11')?.taxBucket).toBe('retido_fonte');
		expect(byKey.get('KNCR11')?.assetClass).toBe('fii');
		expect(byKey.get('KNCR11')?.taxBucket).toBe('fii');
		expect(byKey.get('BOVA11')?.classGuessed).toBe(false);
	});
});

describe('parseB3File movimentação', () => {
	function movimentacaoFixture() {
		const header = [
			'Entrada/Saída',
			'Data',
			'Movimentação',
			'Produto',
			'Instituição',
			'Quantidade',
			'Preço unitário',
			'Valor da Operação'
		];
		return buildXlsx([
			{
				name: 'Movimentação',
				rows: [
					header,
					[
						'Credito',
						'21/08/2026',
						'Rendimento',
						'KNCR11 - KINEA RENDIMENTOS IMOBILIÁRIOS FII',
						'CORRETORA X',
						96,
						0.85,
						81.6
					],
					// Deliberately identical to the row above: legitimate duplicate.
					[
						'Credito',
						'21/08/2026',
						'Rendimento',
						'KNCR11 - KINEA RENDIMENTOS IMOBILIÁRIOS FII',
						'CORRETORA X',
						96,
						0.85,
						81.6
					],
					[
						'Credito',
						'20/08/2026',
						'Transferência - Liquidação',
						'BOVA11 - ISHARES IBOVESPA FUNDO DE ÍNDICE',
						'CORRETORA X',
						10,
						171.5,
						1715
					],
					[
						'Debito',
						'17/08/2026',
						'RESGATE ANTECIPADO',
						'CDB - CDB123ABC - BANCO Z S.A.',
						'BANCO Z S.A.',
						124079,
						0.01000335,
						1241.21
					]
				]
			}
		]);
	}

	it('parses directions, dates and products', async () => {
		const parsed = await parseB3File(await movimentacaoFixture());
		expect(parsed.kind).toBe('movimentacao');
		expect(parsed.events).toHaveLength(4);
		const cdb = parsed.events.find((e) => e.spec.assetClass === 'cdb');
		expect(cdb?.direction).toBe('debit');
		expect(cdb?.eventDate).toBe('2026-08-17');
		expect(cdb?.spec.productKey).toBe('CDB:CDB123ABC');
	});

	it('keeps identical rows apart with occurrence-indexed dedup keys', async () => {
		const parsed = await parseB3File(await movimentacaoFixture());
		const dividends = parsed.events.filter((e) => e.eventType === 'Rendimento');
		expect(dividends).toHaveLength(2);
		expect(dividends[0].dedupKey).not.toBe(dividends[1].dedupKey);
		expect(dividends[0].dedupKey.replace(/\|\d+$/, '')).toBe(
			dividends[1].dedupKey.replace(/\|\d+$/, '')
		);
	});

	it('produces the same dedup keys on re-parse (idempotent re-upload)', async () => {
		const first = await parseB3File(await movimentacaoFixture());
		const second = await parseB3File(await movimentacaoFixture());
		expect(second.events.map((e) => e.dedupKey)).toEqual(
			first.events.map((e) => e.dedupKey)
		);
	});
});

describe('parseB3File negociação', () => {
	function negociacaoFixture() {
		return buildXlsx([
			{
				name: 'Negociação',
				rows: [
					[
						'Data do Negócio',
						'Tipo de Movimentação',
						'Mercado',
						'Prazo/Vencimento',
						'Instituição',
						'Código de Negociação',
						'Quantidade',
						'Preço',
						'Valor'
					],
					[
						'26/08/2026',
						'Compra',
						'Mercado à Vista',
						'-',
						'CORRETORA X',
						'KNCR11',
						50,
						107.1,
						5355
					],
					[
						'19/08/2026',
						'Venda',
						'Mercado à Vista',
						'-',
						'CORRETORA X',
						'BOVA11',
						20,
						170.0,
						3400
					]
				]
			}
		]);
	}

	it('parses trades with venda as debit', async () => {
		const parsed = await parseB3File(await negociacaoFixture());
		expect(parsed.kind).toBe('negociacao');
		expect(parsed.events).toHaveLength(2);
		const venda = parsed.events.find((e) => e.eventType === 'Venda');
		expect(venda?.direction).toBe('debit');
		expect(venda?.unitPrice).toBe(170.0);
		expect(venda?.source).toBe('b3_negociacao');
	});
});

describe('parseB3File errors', () => {
	it('rejects non-xlsx buffers', async () => {
		await expect(parseB3File(Buffer.from('data,csv\n1,2'))).rejects.toThrow(
			/xlsx/
		);
	});

	it('rejects unrecognized workbooks', async () => {
		const alien = await buildXlsx([
			{
				name: 'Sheet1',
				rows: [
					['a', 'b'],
					[1, 2]
				]
			}
		]);
		await expect(parseB3File(alien)).rejects.toThrow(/reconhecer/);
	});
});

describe('resolveAssetSpec heuristics', () => {
	it('guesses fii for suffix-11 tickers seen outside posição', () => {
		const spec = resolveAssetSpec(
			'KNCR11 - KINEA RENDIMENTOS IMOBILIÁRIOS FII'
		);
		expect(spec.assetClass).toBe('fii');
		expect(spec.classGuessed).toBe(true);
	});

	it('guesses acao for suffix 3/4 tickers', () => {
		expect(resolveAssetSpec('PETR4').assetClass).toBe('acao');
		expect(resolveAssetSpec('VALE3 - VALE S.A.').assetClass).toBe('acao');
	});

	it('never assigns a DARF bucket to unclassifiable products', () => {
		const spec = resolveAssetSpec('COISA DESCONHECIDA QUALQUER');
		expect(spec.assetClass).toBe('outro');
		expect(spec.taxBucket).toBe('retido_fonte');
		expect(spec.classGuessed).toBe(true);
	});

	it('is accent- and spacing-stable for product keys', () => {
		const a = resolveAssetSpec('Tesouro  IPCA+   2032');
		const b = resolveAssetSpec('TESOURO IPCA+ 2032');
		expect(a.productKey).toBe(b.productKey);
	});
});

describe('helpers', () => {
	it('extracts the snapshot date from B3 filenames', () => {
		expect(snapshotDateFromFilename('posicao-2026-08-27-17-47-52.xlsx')).toBe(
			'2026-08-27'
		);
		expect(snapshotDateFromFilename('minha-posicao.xlsx')).toBeNull();
	});

	it('parses dd/mm/yyyy and rejects garbage', () => {
		expect(parseB3Date('15/08/2032')).toBe('2032-08-15');
		expect(parseB3Date('2026-08-27')).toBeNull();
		expect(parseB3Date('40/13/2026')).toBeNull();
		expect(parseB3Date(null)).toBeNull();
	});
});
