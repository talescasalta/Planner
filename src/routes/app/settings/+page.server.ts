import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { getUserHouseholdId } from '$lib/server/household';
import { parseOwnNames } from '$lib/server/own-names';
import { supabaseAdmin } from '$lib/server/supabase';

export const load: PageServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	const householdId = user ? await getUserHouseholdId(supabase, user.id) : null;
	if (!householdId) return { ownNames: [] as string[] };
	const { data } = await supabase
		.from('households')
		.select('own_account_names')
		.eq('id', householdId)
		.maybeSingle();
	return { ownNames: (data?.own_account_names ?? []) as string[] };
};

export const actions: Actions = {
	update_own_names: async ({
		request,
		locals: { supabase, safeGetSession }
	}) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const householdId = await getUserHouseholdId(supabase, user.id);
		if (!householdId) {
			return fail(400, {
				success: false,
				message: 'Usuário não pertence a um grupo'
			});
		}

		const formData = await request.formData();
		const parsed = parseOwnNames(String(formData.get('own_names') ?? ''));
		if (parsed.error !== undefined) {
			return fail(400, { success: false, message: parsed.error });
		}

		// households has no update policy for members; the membership was just
		// established through the user's own client above.
		const { error } = await supabaseAdmin
			.from('households')
			.update({ own_account_names: parsed.names })
			.eq('id', householdId);
		if (error) return fail(500, { success: false, message: error.message });

		return {
			success: true,
			message:
				parsed.names.length > 0
					? 'Nomes salvos. As próximas importações vão sugerir transferências entre suas contas.'
					: 'Nomes removidos. Nenhuma transferência será sugerida.'
		};
	}
};
