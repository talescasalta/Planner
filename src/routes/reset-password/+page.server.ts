import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { session, user, profile } = await safeGetSession();
	if (!user) {
		redirect(303, '/forgot-password');
	}

	return { session, user, profile };
};

export const actions: Actions = {
	default: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) {
			return {
				success: false,
				message: 'Link de recuperação inválido ou expirado.'
			};
		}

		const formData = await request.formData();
		const password = String(formData.get('password') ?? '');
		const confirmPassword = String(formData.get('confirm_password') ?? '');

		if (password.length < 8) {
			return {
				success: false,
				message: 'A senha precisa ter pelo menos 8 caracteres.'
			};
		}

		if (password !== confirmPassword) {
			return { success: false, message: 'As senhas não conferem.' };
		}

		const { error } = await supabase.auth.updateUser({ password });
		if (error) {
			return { success: false, message: error.message };
		}

		return {
			success: true,
			message: 'Senha atualizada com sucesso. Você já pode entrar normalmente.'
		};
	}
};
