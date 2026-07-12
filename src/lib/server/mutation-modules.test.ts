import { describe, expect, it } from 'vitest';
import {
	calculateModuleScore,
	evaluateModules
} from '../../../scripts/check-mutation-modules.mjs';

const filesReport = {
	'a.ts': {
		mutants: [
			{ status: 'Killed' },
			{ status: 'Survived' },
			{ status: 'NoCoverage' }
		]
	},
	'b.ts': { mutants: [{ status: 'Timeout' }, { status: 'Ignored' }] }
};

describe('mutation module gate', () => {
	it('counts killed and timeout mutants as detected and excludes ignored mutants', () => {
		expect(calculateModuleScore(filesReport, ['a.ts', 'b.ts'])).toEqual({
			detected: 2,
			total: 4,
			score: 50
		});
	});

	it('evaluates independent module thresholds from the same report', () => {
		const results = evaluateModules(
			{ files: filesReport },
			{
				modules: [
					{ name: 'a', minimum: 30, files: ['a.ts'] },
					{ name: 'b', minimum: 90, files: ['b.ts'] }
				]
			}
		);

		expect(results[0]).toMatchObject({ name: 'a' });
		expect(results[0].score).toBeCloseTo(100 / 3);
		expect(results[1]).toMatchObject({ name: 'b', score: 100 });
	});

	it('fails clearly when a configured source file is absent from the report', () => {
		expect(() => calculateModuleScore(filesReport, ['missing.ts'])).toThrow(
			'Mutation report is missing configured file: missing.ts'
		);
	});
});
