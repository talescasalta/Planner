// Supabase and LLM provider errors carry table, column, constraint and policy
// names. They belong in the server log; the browser only gets a generic
// message (see SECURITY.md, "Erros internos").
export const INTERNAL_ERROR_MESSAGE =
	'Não foi possível concluir a operação. Tente novamente.';

export function logInternalError(context: string, error: unknown): string {
	console.error(`[${context}]`, error);
	return INTERNAL_ERROR_MESSAGE;
}

// Supabase Auth errors that the person can act on, keyed by `AuthError.code`.
// Anything else is logged and replaced by the caller's fallback.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
	invalid_credentials: 'E-mail ou senha inválidos.',
	email_not_confirmed: 'Confirme seu e-mail antes de entrar.',
	weak_password:
		'Senha fraca ou já exposta em vazamentos. Escolha outra senha.',
	same_password: 'A nova senha precisa ser diferente da atual.',
	signup_disabled: 'O cadastro está desativado nesta instância.',
	over_email_send_rate_limit:
		'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
	over_request_rate_limit:
		'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
};

export function authErrorMessage(
	context: string,
	error: { code?: string },
	fallback: string
): string {
	const known = error.code ? AUTH_ERROR_MESSAGES[error.code] : undefined;
	if (known) return known;
	console.error(`[${context}]`, error);
	return fallback;
}
