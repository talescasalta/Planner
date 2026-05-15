import { describe, expect, it } from 'vitest';
import { confidenceForReinforcement } from './learning';

describe('confidenceForReinforcement', () => {
	it('keeps the first correction below auto-confirmation and raises after reinforcement', () => {
		expect(confidenceForReinforcement(1)).toBe(0.65);
		expect(confidenceForReinforcement(2)).toBe(0.72);
		expect(confidenceForReinforcement(3)).toBe(0.85);
		expect(confidenceForReinforcement(10)).toBe(0.85);
	});
});
