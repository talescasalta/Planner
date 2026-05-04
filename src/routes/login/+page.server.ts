import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request, url, locals: { supabase } }) => {
		const formData = await request.formData();
		const action = formData.get('action') as string;
		const email = formData.get('email') as string;
		const password = formData.get('password') as string;

		if (action === 'signup') {
			const { error } = await supabase.auth.signUp({
				email,
				password,
				options: {
					emailRedirectTo: `${url.origin}/auth/confirm`
				}
			});

			if (error) {
				return { success: false, message: error.message };
			}

			return { success: true, message: 'Verifique seu email para confirmar o cadastro.' };
		}

		const { error } = await supabase.auth.signInWithPassword({ email, password });

		if (error) {
			return { success: false, message: error.message };
		}

		redirect(303, '/app');
	}
};
