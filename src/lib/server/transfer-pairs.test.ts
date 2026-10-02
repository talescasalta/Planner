import { describe, expect, it } from 'vitest';
import { matchTransferPairs, type PairRow } from './transfer-pairs';

const NAMES = ['Tales Casalta', 'Tales C'];

function row(overrides: Partial<PairRow> & { id: string }): PairRow {
	return {
		date: '2026-09-03',
		amount: 1000,
		description: 'PIX TRANSF Tales C03/09',
		source_name: 'Itaú conta',
		isTransfer: false,
		...overrides
	};
}

const nubankSide = row({
	id: 'nu',
	amount: -1000,
	description:
		'Transferência enviada pelo Pix - Tales Casalta - •••.698.868-•• - ITAÚ UNIBANCO S.A.',
	source_name: 'Nubank conta'
});

describe('matchTransferPairs', () => {
	it('pairs the September 3rd Pix between the Itaú and Nubank accounts', () => {
		const pairs = matchTransferPairs(
			[row({ id: 'itau' })],
			[nubankSide],
			NAMES
		);

		expect(pairs).toEqual([{ insertedId: 'itau', candidateId: 'nu' }]);
	});

	it('does not pair a reimbursement with a payment to someone else', () => {
		const careplus = row({
			id: 'cp',
			amount: 1222.44,
			date: '2026-09-15',
			description: 'SISPAG CARE PLUS'
		});
		const toGloria = row({
			id: 'gl',
			amount: -1222.44,
			date: '2026-09-15',
			description: 'Transferência enviada pelo Pix - Gloria Menz Ferreira',
			source_name: 'Nubank conta'
		});

		expect(matchTransferPairs([careplus], [toGloria], NAMES)).toEqual([]);
	});

	it('needs the same amount with the opposite sign within two days', () => {
		const inserted = [row({ id: 'itau' })];

		expect(
			matchTransferPairs(inserted, [{ ...nubankSide, amount: 1000 }], NAMES)
		).toEqual([]);
		expect(
			matchTransferPairs(inserted, [{ ...nubankSide, amount: -999.99 }], NAMES)
		).toEqual([]);
		expect(
			matchTransferPairs(
				inserted,
				[{ ...nubankSide, date: '2026-09-05' }],
				NAMES
			).length
		).toBe(1);
		expect(
			matchTransferPairs(
				inserted,
				[{ ...nubankSide, date: '2026-09-06' }],
				NAMES
			)
		).toEqual([]);
	});

	it('does not pair rows of the same account or rows without one', () => {
		const inserted = [row({ id: 'itau' })];

		expect(
			matchTransferPairs(
				inserted,
				[{ ...nubankSide, source_name: 'Itaú conta' }],
				NAMES
			)
		).toEqual([]);
		expect(
			matchTransferPairs(
				inserted,
				[{ ...nubankSide, source_name: null }],
				NAMES
			)
		).toEqual([]);
	});

	it('leaves rows already treated as transfers alone', () => {
		expect(
			matchTransferPairs(
				[row({ id: 'itau' })],
				[{ ...nubankSide, isTransfer: true }],
				NAMES
			)
		).toEqual([]);
		expect(
			matchTransferPairs(
				[row({ id: 'itau', isTransfer: true })],
				[nubankSide],
				NAMES
			)
		).toEqual([]);
	});

	it('does nothing until the household has registered its names', () => {
		expect(matchTransferPairs([row({ id: 'itau' })], [nubankSide], [])).toEqual(
			[]
		);
	});

	it('skips an ambiguous match instead of guessing', () => {
		const twin = { ...nubankSide, id: 'nu2' };

		expect(
			matchTransferPairs([row({ id: 'itau' })], [nubankSide, twin], NAMES)
		).toEqual([]);
		// Two new rows competing for one counterpart.
		expect(
			matchTransferPairs(
				[row({ id: 'a' }), row({ id: 'b' })],
				[nubankSide],
				NAMES
			)
		).toEqual([]);
	});

	it('pairs several unambiguous transfers in one import', () => {
		const second = row({ id: 'itau2', amount: 250, date: '2026-09-10' });
		const secondOther = {
			...nubankSide,
			id: 'nu2',
			amount: -250,
			date: '2026-09-10'
		};

		expect(
			matchTransferPairs(
				[row({ id: 'itau' }), second],
				[nubankSide, secondOther],
				NAMES
			)
		).toEqual([
			{ insertedId: 'itau', candidateId: 'nu' },
			{ insertedId: 'itau2', candidateId: 'nu2' }
		]);
	});
});
