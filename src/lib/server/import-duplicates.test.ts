import { describe, expect, it } from 'vitest';
import {
	findPossibleDuplicates,
	isIsoDate,
	planImport,
	shiftIsoDate,
	type ExistingTransaction,
	type ImportCandidateRow
} from './import-duplicates';

const target = { accountName: 'Itaú conta', sourceType: 'bank_account' };

function existing(
	overrides: Partial<ExistingTransaction> & { id: string }
): ExistingTransaction {
	return {
		date: '2026-06-15',
		amount: -500,
		description: 'Joana Ramos',
		clean_description: 'JOANA RAMOS',
		source_name: 'Itaú conta',
		source_type: 'bank_account',
		import_dedup_key: '2026-06-15|JOANA RAMOS|-500.00|BRL',
		review_status: 'confirmed',
		...overrides
	};
}

function row(
	overrides: Partial<ImportCandidateRow> & { dedup_key: string }
): ImportCandidateRow {
	return {
		date: '2026-06-15',
		amount: -500,
		description: 'PIX TRANSF JOANA 13/06',
		clean_description: 'PIX TRANSF JOANA',
		...overrides
	};
}

describe('findPossibleDuplicates', () => {
	it('flags a Pix that another source already recorded under a different text', () => {
		const found = findPossibleDuplicates(
			[row({ dedup_key: 'k1' })],
			[existing({ id: 'e1' })],
			target
		);

		expect(found.get('k1')?.id).toBe('e1');
	});

	it('allows a one-day difference and prefers the closest date', () => {
		const found = findPossibleDuplicates(
			[row({ dedup_key: 'k1', date: '2026-06-15' })],
			[
				existing({ id: 'far', date: '2026-06-16' }),
				existing({ id: 'same', date: '2026-06-15' })
			],
			target
		);

		expect(found.get('k1')?.id).toBe('same');
		expect(
			findPossibleDuplicates(
				[row({ dedup_key: 'k1', date: '2026-06-18' })],
				[existing({ id: 'e1' })],
				target
			).size
		).toBe(0);
	});

	it('does not flag the same amount in another account', () => {
		const found = findPossibleDuplicates(
			[row({ dedup_key: 'k1' })],
			[existing({ id: 'e1', source_name: 'Nubank conta' })],
			target
		);

		expect(found.size).toBe(0);
	});

	it('falls back to the kind of source when the existing row has no account', () => {
		const sameKind = existing({ id: 'e1', source_name: null });
		const otherKind = existing({
			id: 'e2',
			source_name: null,
			source_type: 'credit_card'
		});

		expect(
			findPossibleDuplicates([row({ dedup_key: 'k1' })], [sameKind], target)
				.size
		).toBe(1);
		expect(
			findPossibleDuplicates([row({ dedup_key: 'k1' })], [otherKind], target)
				.size
		).toBe(0);
	});

	it('lets one existing transaction explain only one new row', () => {
		const found = findPossibleDuplicates(
			[
				row({ dedup_key: 'k1' }),
				row({
					dedup_key: 'k2',
					description: 'OUTRO TEXTO',
					clean_description: 'OUTRO TEXTO'
				})
			],
			[existing({ id: 'e1' })],
			target
		);

		expect([...found.keys()]).toEqual(['k1']);
	});

	it('ignores rows already ignored and amounts that differ by a cent', () => {
		expect(
			findPossibleDuplicates(
				[row({ dedup_key: 'k1' })],
				[existing({ id: 'e1', review_status: 'ignored' })],
				target
			).size
		).toBe(0);
		expect(
			findPossibleDuplicates(
				[row({ dedup_key: 'k1', amount: -500.01 })],
				[existing({ id: 'e1' })],
				target
			).size
		).toBe(0);
	});

	it('does not treat identical text on adjacent days as another source', () => {
		const found = findPossibleDuplicates(
			[
				row({
					dedup_key: 'k1',
					date: '2026-06-16',
					description: 'Joana Ramos',
					clean_description: 'JOANA RAMOS'
				})
			],
			[existing({ id: 'e1' })],
			target
		);

		expect(found.size).toBe(0);
	});
});

describe('planImport', () => {
	it('skips exact repeats, tags possible duplicates and describes them for the preview', () => {
		const stored = existing({ id: 'e1' });
		const exact = existing({
			id: 'e2',
			date: '2026-07-01',
			amount: -10,
			description: 'Padaria',
			clean_description: 'PADARIA',
			import_dedup_key: 'exact-key'
		});

		const plan = planImport(
			[
				row({ dedup_key: 'exact-key', date: '2026-07-01', amount: -10 }),
				row({ dedup_key: 'k1' }),
				row({
					dedup_key: 'k3',
					date: '2026-08-01',
					amount: -3,
					description: 'Novo',
					clean_description: 'NOVO'
				})
			],
			[stored, exact],
			target
		);

		expect(plan.exactDuplicates).toBe(1);
		expect(plan.toInsert.map((r) => r.dedup_key)).toEqual(['k1', 'k3']);
		expect(plan.toInsert[0].duplicate_of?.id).toBe('e1');
		expect(plan.toInsert[1].duplicate_of).toBeUndefined();
		expect(plan.possible).toEqual([
			{
				date: '2026-06-15',
				description: 'PIX TRANSF JOANA 13/06',
				amount: -500,
				existing_date: '2026-06-15',
				existing_description: 'Joana Ramos'
			}
		]);
	});
});

describe('isIsoDate', () => {
	it('accepts real dates only', () => {
		expect(isIsoDate('2026-09-03')).toBe(true);
		expect(isIsoDate('sem data')).toBe(false);
		expect(isIsoDate('')).toBe(false);
		expect(isIsoDate('2026-13-45')).toBe(false);
	});

	it('never flags a row whose date cannot be read', () => {
		const found = findPossibleDuplicates(
			[row({ dedup_key: 'k1', date: 'sem data' })],
			[existing({ id: 'e1' })],
			target
		);

		expect(found.size).toBe(0);
	});
});

describe('shiftIsoDate', () => {
	it('moves across month and year boundaries', () => {
		expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
		expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
	});
});
