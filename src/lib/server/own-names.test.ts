import { describe, expect, it } from 'vitest';
import { foldForMatch, mentionsOwnName, parseOwnNames } from './own-names';

const NAMES = ['Maria Silva', 'Maria S'];

describe('parseOwnNames', () => {
	it('reads one name per line, trimming and dropping blanks and repeats', () => {
		expect(
			parseOwnNames('  Maria   Silva \n\nMARIA silva\r\nMaria S\n')
		).toEqual({ names: ['Maria Silva', 'Maria S'] });
	});

	it('treats accents and case as the same name', () => {
		expect(parseOwnNames('Júlia Costa\nJulia costa')).toEqual({
			names: ['Júlia Costa']
		});
	});

	it('accepts an empty list so the suggestions can be turned off', () => {
		expect(parseOwnNames('')).toEqual({ names: [] });
	});

	it('rejects names that are too short or too long and too many names', () => {
		expect(parseOwnNames('ab').error).toContain('entre 3 e 60');
		expect(parseOwnNames('x'.repeat(61)).error).toContain('entre 3 e 60');
		const many = Array.from({ length: 11 }, (_, i) => `Nome ${i}x`).join('\n');
		expect(parseOwnNames(many).error).toContain('no máximo 10');
	});
});

describe('mentionsOwnName', () => {
	it('matches the truncated Itaú form and the full Nubank form', () => {
		expect(mentionsOwnName('PIX TRANSF Maria S03/09', NAMES)).toBe(true);
		expect(
			mentionsOwnName(
				'Transferência enviada pelo Pix - Maria Silva - •••.123.456-••',
				NAMES
			)
		).toBe(true);
	});

	it('ignores case and accents', () => {
		expect(mentionsOwnName('pix recebido MARIA SILVA', NAMES)).toBe(true);
		expect(mentionsOwnName('Pix Júlia Costa', ['Julia Costa'])).toBe(true);
	});

	it('does not match a longer name that merely starts the same way', () => {
		expect(mentionsOwnName('PIX TRANSF Maria Santos', NAMES)).toBe(false);
		expect(mentionsOwnName('Transferência para Ana Maria', NAMES)).toBe(false);
	});

	it('does not match other people or an empty list', () => {
		expect(
			mentionsOwnName('Transferência enviada pelo Pix - Julia Costa', NAMES)
		).toBe(false);
		expect(mentionsOwnName('PIX TRANSF Maria S03/09', [])).toBe(false);
	});

	it('does not treat regex characters in a name as a pattern', () => {
		expect(mentionsOwnName('pix a.b', ['a.b'])).toBe(true);
		expect(mentionsOwnName('pix axb', ['a.b'])).toBe(false);
	});
});

describe('foldForMatch', () => {
	it('lowers case, strips accents and collapses spaces', () => {
		expect(foldForMatch('  Júlia   COSTA ')).toBe('julia costa');
	});
});
