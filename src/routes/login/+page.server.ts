import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { Actions, PageServerLoad } from './$types';
import { publicUrl } from '$lib/server/public-url';

// A public instance can close sign-up once the household has its accounts.
// Supabase Auth's own "Allow new users to sign up" switch is what also stops
// new Google logins; this one hides the form and refuses email sign-ups.
function signupEnabled() {
	return env.SIGNUP_ENABLED?.trim().toLowerCase() !== 'false';
}

export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
	const { session, user, profile } = await safeGetSession();
	return { session, user, profile, signupEnabled: signupEnabled() };
};

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
			if (!signupEnabled()) {
				return {
					success: false,
					message: 'O cadastro está desativado nesta instância.'
				};
			}

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
