import { describe, expect, it, vi } from 'vitest';
import { signPreview, verifyPreview } from './import-preview-token';

vi.mock('$env/dynamic/private', () => ({
	env: { SUPABASE_SECRET_KEY: 'test-secret' }
}));

const payload = {
	householdId: 'household-a',
	userId: 'user-a',
	sourceType: 'bank_account' as const,
	sourceName: 'itau_extrato.pdf',
	accountName: 'Itaú conta',
	rows: [
		{
			date: '2026-09-01',
			description: 'DA VIVO-SP 33333333',
			clean_description: 'DA VIVO-SP',
			amount: -100,
			currency: 'BRL'
		}
	]
};

describe('import preview token', () => {
	it('round-trips the reviewed rows', () => {
		const token = signPreview(payload);

		expect(token).toEqual(expect.any(String));
		expect(verifyPreview(token!)).toMatchObject({ ...payload, v: 1 });
	});

	it('rejects a token whose body was altered', () => {
		const token = signPreview(payload)!;
		const [body, signature] = token.split('.');
		const tampered = JSON.parse(Buffer.from(body, 'base64url').toString());
		tampered.rows[0].amount = -1;
		const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`;

		expect(verifyPreview(forged)).toBeNull();
	});

	it('rejects a flipped signature bit and malformed input', () => {
		const token = signPreview(payload)!;
		const last = token.slice(-1) === 'A' ? 'B' : 'A';

		expect(verifyPreview(token.slice(0, -1) + last)).toBeNull();
		expect(verifyPreview('not-a-token')).toBeNull();
		expect(verifyPreview('')).toBeNull();
	});

	it('rejects a token issued without an account', () => {
		const token = signPreview({ ...payload, accountName: undefined as never });

		expect(verifyPreview(token!)).toBeNull();
	});

	it('expires after thirty minutes', () => {
		const issuedAt = 1_000_000;
		const token = signPreview(payload, issuedAt)!;

		expect(verifyPreview(token, issuedAt + 29 * 60_000)).not.toBeNull();
		expect(verifyPreview(token, issuedAt + 31 * 60_000)).toBeNull();
	});

	it('does not issue a token too large to travel back in a form', () => {
		const row = payload.rows[0];

		expect(signPreview({ ...payload, rows: Array(4000).fill(row) })).toBeNull();
	});
});
