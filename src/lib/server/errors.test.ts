import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	INTERNAL_ERROR_MESSAGE,
	authErrorMessage,
	logInternalError
} from './errors';

beforeEach(() => {
	vi.restoreAllMocks();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('error messages for the browser', () => {
	it('logs the internal error and returns only the generic message', () => {
		const error = { message: 'relation "public.transactions" violates policy' };

		expect(logInternalError('ctx', error)).toBe(INTERNAL_ERROR_MESSAGE);
		expect(console.error).toHaveBeenCalledWith('[ctx]', error);
	});

	it('translates auth errors the person can act on', () => {
		expect(
			authErrorMessage('login', { code: 'invalid_credentials' }, 'fallback')
		).toBe('E-mail ou senha inválidos.');
		expect(console.error).not.toHaveBeenCalled();
	});

	it('falls back for unknown auth errors and logs them', () => {
		const error = { code: 'unexpected_failure', message: 'db down' };

		expect(authErrorMessage('login', error, 'fallback')).toBe('fallback');
		expect(console.error).toHaveBeenCalledWith('[login]', error);
	});
});
