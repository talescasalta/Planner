import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actions as loginActions } from '../../routes/login/+page.server';
import { actions as forgotPasswordActions } from '../../routes/forgot-password/+page.server';
import { actions as resetPasswordActions } from '../../routes/reset-password/+page.server';
import { GET as confirmAuth } from '../../routes/auth/confirm/+server';

const { redirectMock } = vi.hoisted(() => ({
	redirectMock: vi.fn()
}));

vi.mock('@sveltejs/kit', () => ({ redirect: redirectMock }));
vi.mock('$lib/server/public-url', () => ({
	publicUrl: (origin: string, path: string) => `${origin}${path}`
}));

function requestWith(fields: Record<string, string>) {
	const formData = new FormData();
	for (const [key, value] of Object.entries(fields)) formData.set(key, value);
	return { formData: async () => formData } as never;
}

function authClient(overrides: Record<string, unknown> = {}) {
	return {
		signInWithOAuth: vi
			.fn()
			.mockResolvedValue({ data: { url: null }, error: null }),
		signUp: vi.fn().mockResolvedValue({ error: null }),
		signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
		resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
		updateUser: vi.fn().mockResolvedValue({ error: null }),
		exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
		verifyOtp: vi.fn().mockResolvedValue({ error: null }),
		...overrides
	};
}

beforeEach(() => redirectMock.mockClear());

describe('authentication actions', () => {
	it('rejects weak signup passwords before calling Supabase Auth', async () => {
		const auth = authClient();
		const result = await loginActions.default({
			request: requestWith({
				action: 'signup',
				email: 'a@example.com',
				password: 'short'
			}),
			url: new URL('https://planner.test/login'),
			locals: { supabase: { auth } }
		} as never);

		expect(result).toMatchObject({
			success: false,
			message: 'A senha precisa ter pelo menos 8 caracteres.'
		});
		expect(auth.signUp).not.toHaveBeenCalled();
	});

	it('returns password login failures without redirecting', async () => {
		const auth = authClient({
			signInWithPassword: vi
				.fn()
				.mockResolvedValue({ error: { message: 'invalid credentials' } })
		});
		const result = await loginActions.default({
			request: requestWith({
				action: 'login',
				email: 'a@example.com',
				password: 'password123'
			}),
			url: new URL('https://planner.test/login'),
			locals: { supabase: { auth } }
		} as never);

		expect(result).toMatchObject({
			success: false,
			message: 'invalid credentials'
		});
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it('does not request password recovery without an email', async () => {
		const auth = authClient();
		const result = await forgotPasswordActions.default({
			request: requestWith({ email: '   ' }),
			url: new URL('https://planner.test/forgot-password'),
			locals: { supabase: { auth } }
		} as never);

		expect(result).toMatchObject({
			success: false,
			message: 'Informe seu email.'
		});
		expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
	});

	it('surfaces password recovery persistence failures', async () => {
		const auth = authClient({
			resetPasswordForEmail: vi
				.fn()
				.mockResolvedValue({ error: { message: 'mail unavailable' } })
		});
		const result = await forgotPasswordActions.default({
			request: requestWith({ email: 'a@example.com' }),
			url: new URL('https://planner.test/forgot-password'),
			locals: { supabase: { auth } }
		} as never);

		expect(result).toMatchObject({
			success: false,
			message: 'mail unavailable'
		});
		expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', {
			redirectTo: 'https://planner.test/auth/confirm?next=/reset-password'
		});
	});

	it('rejects expired recovery sessions before updating the password', async () => {
		const auth = authClient();
		const result = await resetPasswordActions.default({
			request: requestWith({
				password: 'password123',
				confirm_password: 'password123'
			}),
			locals: {
				supabase: { auth },
				safeGetSession: async () => ({ user: null })
			}
		} as never);

		expect(result).toMatchObject({
			success: false,
			message: 'Link de recuperação inválido ou expirado.'
		});
		expect(auth.updateUser).not.toHaveBeenCalled();
	});

	it('surfaces password update failures for valid recovery sessions', async () => {
		const auth = authClient({
			updateUser: vi
				.fn()
				.mockResolvedValue({ error: { message: 'update unavailable' } })
		});
		const result = await resetPasswordActions.default({
			request: requestWith({
				password: 'password123',
				confirm_password: 'password123'
			}),
			locals: {
				supabase: { auth },
				safeGetSession: async () => ({ user: { id: 'user-a' } })
			}
		} as never);

		expect(result).toMatchObject({
			success: false,
			message: 'update unavailable'
		});
		expect(auth.updateUser).toHaveBeenCalledWith({ password: 'password123' });
	});

	it('prevents external next URLs in auth confirmation redirects', async () => {
		const auth = authClient();
		const url = new URL(
			'https://planner.test/auth/confirm?next=https://evil.test'
		);

		await confirmAuth({ url, locals: { supabase: { auth } } } as never);

		expect(redirectMock).toHaveBeenLastCalledWith(
			303,
			new URL('https://planner.test/auth/error')
		);
		expect(redirectMock.mock.calls.flat().join(' ')).not.toContain('evil.test');
	});
});
