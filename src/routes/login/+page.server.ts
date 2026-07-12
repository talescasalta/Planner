import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { publicUrl } from '$lib/server/public-url';

export const actions: Actions = {
	default: async ({ request, url, locals: { supabase } }) => {
		const formData = await request.formData();
		const action = formData.get('action') as string;
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (action === 'google') {
			const { data, error } = await supabase.auth.signInWithOAuth({
				provider: 'google',
				options: {
					redirectTo: publicUrl(url.origin, '/auth/confirm?next=/app')
				}
			});

			if (error) {
				return { success: false, message: error.message };
			}

			if (data.url) {
				redirect(303, data.url);
			}

			return {
				success: false,
				message: 'Não foi possível iniciar o login com Google.'
			};
		}

		if (action === 'signup') {
			if (!password || password.length < 8) {
				return {
					success: false,
					message: 'A senha precisa ter pelo menos 8 caracteres.'
				};
			}

			const { error } = await supabase.auth.signUp({
				email,
				password,
				options: {
					emailRedirectTo: publicUrl(url.origin, '/auth/confirm')
				}
			});

			if (error) {
				return { success: false, message: error.message };
			}

			return {
				success: true,
				message: 'Verifique seu email para confirmar o cadastro.'
			};
		}

		const { error } = await supabase.auth.signInWithPassword({
			email,
			password
		});

		if (error) {
			return { success: false, message: error.message };
		}

		redirect(303, '/app');
	}
};
