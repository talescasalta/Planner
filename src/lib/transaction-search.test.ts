import { describe, expect, it } from 'vitest';
import {
	MAX_SEARCH_LENGTH,
	cleanSearchTerm,
	matchesSearch
} from './transaction-search';

const pix = {
	description: 'Transferência enviada pelo Pix - Clínica Exemplo Ltda',
	clean_description: null,
	category_display_name: 'Saúde',
	subcategory_display_name: 'Consulta'
};

describe('matchesSearch', () => {
	it('matches any of the searchable fields, ignoring case', () => {
		expect(matchesSearch(pix, 'exemplo')).toBe(true);
		expect(matchesSearch(pix, 'CONSULTA')).toBe(true);
	});

	it('ignores accents on both sides', () => {
		expect(matchesSearch(pix, 'transferencia')).toBe(true);
		expect(matchesSearch(pix, 'saude')).toBe(true);
		expect(matchesSearch({ description: 'Farmacia' }, 'farmácia')).toBe(true);
	});

	it('treats an empty term as no filter', () => {
		expect(matchesSearch(pix, '   ')).toBe(true);
	});

	it('rejects rows that mention the term nowhere', () => {
		expect(matchesSearch(pix, 'mercado')).toBe(false);
	});
});

describe('cleanSearchTerm', () => {
	it('trims and caps the term', () => {
		expect(cleanSearchTerm('  exemplo ')).toBe('exemplo');
		expect(cleanSearchTerm('x'.repeat(500))).toHaveLength(MAX_SEARCH_LENGTH);
		expect(cleanSearchTerm(null)).toBe('');
	});
});
