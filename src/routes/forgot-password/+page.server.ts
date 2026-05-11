import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, url, locals: { supabase } }) => {
		const formData = await request.formData();
		const email = String(formData.get('email') ?? '').trim();

		if (!email) {
			return { success: false, message: 'Informe seu email.' };
		}

		const { error } = await supabase.auth.resetPasswordForEmail(email, {
			redirectTo: `${url.origin}/auth/confirm?next=/reset-password`
		});

		if (error) {
			return { success: false, message: error.message };
		}

		return {
			success: true,
			message: 'Se existir uma conta com esse email, enviaremos um link para redefinir a senha.'
		};
	}
};
