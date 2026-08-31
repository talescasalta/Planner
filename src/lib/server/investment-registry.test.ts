import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }));

import {
	foldForSearch,
	parseRegistry,
	searchTerms
} from './investment-registry';

describe('foldForSearch', () => {
	it('folds accents, case and punctuation so a screenshot title can match', () => {
		expect(foldForSearch('Nu Seleção Potencial - Resp. Ltda')).toBe(
			'NU SELECAO POTENCIAL RESP LTDA'
		);
		expect(foldForSearch('  Kinea   Atlas II  ')).toBe('KINEA ATLAS II');
	});

	it('keeps the plus sign that distinguishes Tesouro IPCA+ style names', () => {
		expect(foldForSearch('Tesouro IPCA+ 2032')).toBe('TESOURO IPCA+ 2032');
	});

	it('folds every accent the registry actually contains', () => {
		// These are the ones that were silently destroyed when the latin-1 file
		// was decoded as UTF-8: the fund became unfindable by its own name.
		expect(foldForSearch('TREND PÓS II XP SEGUROS PREVIDENCIÁRIO')).toBe(
			'TREND POS II XP SEGUROS PREVIDENCIARIO'
		);
		expect(foldForSearch('NU SELEÇÃO POTENCIAL')).toBe('NU SELECAO POTENCIAL');
		expect(foldForSearch('AÇÕES ÍNDICE ÚNICO À VISTA')).toBe(
			'ACOES INDICE UNICO A VISTA'
		);
	});
});

describe('searchTerms', () => {
	it('requires the meaningful words of a truncated title', () => {
		// "Kinea Atlas II FIM RL - Subc…" as the broker screen shows it: the
		// legal-form abbreviations go, the truncated "Subc" stays and matches
		// "SUBCLASSE" in the registry.
		expect(searchTerms('Kinea Atlas II FIM RL - Subc')).toEqual([
			'KINEA',
			'ATLAS',
			'II',
			'SUBC'
		]);
	});

	it('drops the noise words that match half the registry', () => {
		expect(searchTerms('JGP Strategy Advisory FIC FIF')).toEqual([
			'JGP',
			'STRATEGY',
			'ADVISORY'
		]);
	});

	it('drops the legal-form abbreviations the registry spells out instead', () => {
		// "Kinea Atlas II FIM RL" is registered as "KINEA ATLAS II FUNDO DE
		// INVESTIMENTO FINANCEIRO": requiring "FIM" finds nothing.
		expect(searchTerms('Kinea Atlas II FIM RL')).toEqual([
			'KINEA',
			'ATLAS',
			'II'
		]);
		expect(searchTerms('Trend Pós II XP Seg FIC FIM')).toEqual([
			'TREND',
			'POS',
			'II',
			'XP',
			'SEG'
		]);
	});

	it('returns nothing for a query with no usable term', () => {
		expect(searchTerms('de do da')).toEqual([]);
		expect(searchTerms('')).toEqual([]);
	});
});

describe('parseRegistry', () => {
	const classeCsv = [
		'ID_Registro_Fundo;ID_Registro_Classe;CNPJ_Classe;Codigo_CVM;Data_Registro;Tipo_Classe;Denominacao_Social;Situacao',
		'1;8136;29762315000158;240044;2018-01-01;FIF;KINEA ATLAS II FUNDO DE INVESTIMENTO FINANCEIRO;Em Funcionamento Normal',
		'2;8263;30190210000150;240100;2018-01-01;FIF;JGP STRATEGY ADVISORY FI EM COTAS;Em Funcionamento Normal',
		'3;;;;;;;'
	].join('\n');
	const subclasseCsv = [
		'ID_Registro_Classe;ID_Subclasse;Codigo_CVM;Denominacao_Social;Situacao;Previdenciario',
		'8136;30SMU1746554429;240044;SUBCLASSE I DO KINEA ATLAS II;Em Funcionamento Normal;N',
		'8136;M1UAE1770833631;460621;SUBCLASSE IV DO KINEA ATLAS II;Em Funcionamento Normal;N',
		'9999;ORPHAN;1;SUBCLASSE DE CLASSE INEXISTENTE;Normal;N'
	].join('\n');

	it('lists classes and their subclasses as separately addressable rows', () => {
		const rows = parseRegistry(classeCsv, subclasseCsv);
		const kinea = rows.filter((row) => row.cnpj === '29762315000158');
		// The class itself plus its two subclasses: each publishes its own quota.
		expect(kinea).toHaveLength(3);
		expect(kinea.map((row) => row.subclass_id).sort()).toEqual([
			'',
			'30SMU1746554429',
			'M1UAE1770833631'
		]);
	});

	it('carries the parent CNPJ down to each subclass', () => {
		const rows = parseRegistry(classeCsv, subclasseCsv);
		const sub = rows.find((row) => row.subclass_id === '30SMU1746554429');
		expect(sub?.cnpj).toBe('29762315000158');
		expect(sub?.search_name).toContain('SUBCLASSE I DO KINEA ATLAS II');
	});

	it('skips malformed rows and subclasses with no parent', () => {
		const rows = parseRegistry(classeCsv, subclasseCsv);
		expect(rows.some((row) => row.subclass_id === 'ORPHAN')).toBe(false);
		expect(rows.every((row) => row.cnpj.length === 14)).toBe(true);
	});

	it('flags previdenciário subclasses', () => {
		const rows = parseRegistry(
			classeCsv,
			[
				'ID_Registro_Classe;ID_Subclasse;Codigo_CVM;Denominacao_Social;Situacao;Previdenciario',
				'8136;PREV1;1;SUBCLASSE PREV;Normal;S'
			].join('\n')
		);
		expect(
			rows.find((row) => row.subclass_id === 'PREV1')?.previdenciario
		).toBe(true);
	});

	it('collapses a CNPJ the file repeats, keeping the operating registration', () => {
		// The real file registers the same fund more than once, the stale copies
		// cancelled. Both in one batch make the upsert fail on its primary key.
		const repeated = [
			'ID_Registro_Fundo;ID_Registro_Classe;CNPJ_Classe;Codigo_CVM;Data_Registro;Tipo_Classe;Denominacao_Social;Situacao',
			'1;10;30190210000150;1;2018-01-01;FIF;JGP STRATEGY ADVISORY (REGISTRO ANTIGO);Cancelada',
			'2;11;30190210000150;2;2019-01-01;FIF;JGP STRATEGY ADVISORY;Em Funcionamento Normal'
		].join('\n');
		const rows = parseRegistry(repeated, '');
		expect(rows).toHaveLength(1);
		expect(rows[0].situation).toBe('Em Funcionamento Normal');
	});

	it('keeps subclasses of one CNPJ apart, since each publishes its own quota', () => {
		const rows = parseRegistry(classeCsv, subclasseCsv);
		const keys = rows.map((row) => `${row.cnpj}|${row.subclass_id}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('returns nothing when the header is not the expected one', () => {
		expect(parseRegistry('a;b;c\n1;2;3', '')).toEqual([]);
	});
});
