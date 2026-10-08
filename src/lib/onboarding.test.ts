import { describe, expect, it } from 'vitest';
import { buildOnboardingSteps, type OnboardingFacts } from './onboarding';

const fresh: OnboardingFacts = {
	hasGroup: false,
	hasOwnNames: false,
	transactionCount: 0,
	memberCount: 0,
	membersWithIncome: 0
};

const doneIds = (facts: OnboardingFacts, reviewCount: number | null) =>
	buildOnboardingSteps(facts, reviewCount)
		.filter((step) => step.done)
		.map((step) => step.id);

describe('buildOnboardingSteps', () => {
	it('starts with nothing done and no income step for a solo account', () => {
		const steps = buildOnboardingSteps(fresh, null);

		expect(steps.map((step) => step.id)).toEqual([
			'group',
			'names',
			'import',
			'review',
			'member'
		]);
		expect(steps.every((step) => !step.done)).toBe(true);
		expect(steps.find((step) => step.id === 'member')?.optional).toBe(true);
	});

	it('marks review done only after something was imported and nothing waits', () => {
		const imported = {
			...fresh,
			hasGroup: true,
			memberCount: 1,
			transactionCount: 10
		};

		expect(doneIds({ ...fresh, hasGroup: true }, 0)).not.toContain('review');
		expect(doneIds(imported, 3)).not.toContain('review');
		expect(doneIds(imported, null)).not.toContain('review');
		expect(doneIds(imported, 0)).toEqual(['group', 'import', 'review']);
	});

	it('asks for every member income once someone else joined', () => {
		const couple = {
			...fresh,
			hasGroup: true,
			hasOwnNames: true,
			memberCount: 2,
			membersWithIncome: 1
		};

		expect(buildOnboardingSteps(couple, null).at(-1)).toMatchObject({
			id: 'income',
			done: false
		});
		expect(doneIds({ ...couple, membersWithIncome: 2 }, null)).toEqual([
			'group',
			'names',
			'member',
			'income'
		]);
	});
});
