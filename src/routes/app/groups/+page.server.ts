import type { PageServerLoad, Actions } from './$types';
import { supabaseAdmin } from '$lib/server/supabase';
import { seedDefaultCategories, seedDefaultFinancialProfiles } from '$lib/server/household';
import { isHouseholdAdmin } from '$lib/server/access';
import { fail, redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const { data: memberships } = await supabase
		.from('household_members')
		.select('household_id, role, households ( id, name, created_at )')
		.eq('user_id', user.id);

	const groups = (memberships ?? []).map((m) => ({
		id: (m.households as unknown as { id: string; name: string; created_at: string }).id,
		name: (m.households as unknown as { id: string; name: string; created_at: string }).name,
		created_at: (m.households as unknown as { id: string; name: string; created_at: string }).created_at,
		role: m.role
	}));

	const groupsWithMembers = [];
	for (const group of groups) {
		const { data: members } = await supabase
			.from('household_members')
			.select('user_id, role, profiles ( display_name )')
			.eq('household_id', group.id);

		groupsWithMembers.push({
			...group,
			members: (members ?? []).map((m) => ({
				user_id: m.user_id,
				role: m.role,
				display_name: (m.profiles as unknown as { display_name: string })?.display_name ?? 'Sem nome'
			}))
		});
	}

	return { groups: groupsWithMembers };
};

export const actions: Actions = {
	create: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const name = (formData.get('name') as string)?.trim();
		if (!name) return fail(400, { success: false, message: 'Nome do grupo é obrigatório' });

		const { data: household, error: hError } = await supabaseAdmin
			.from('households')
			.insert({ name })
			.select()
			.single();

		if (hError || !household) {
			return fail(500, { success: false, message: hError?.message ?? 'Erro ao criar grupo' });
		}

		const { error: mError } = await supabaseAdmin
			.from('household_members')
			.insert({ household_id: household.id, user_id: user.id, role: 'admin' });

		if (mError) {
			await supabaseAdmin.from('households').delete().eq('id', household.id);
			return fail(500, { success: false, message: mError.message });
		}

		try {
			await seedDefaultCategories(supabaseAdmin, household.id);
			await seedDefaultFinancialProfiles(supabaseAdmin, household.id);
		} catch (e) {
			console.error('[groups/create] seed failed', e);
			await supabaseAdmin.from('household_members').delete().eq('household_id', household.id);
			await supabaseAdmin.from('households').delete().eq('id', household.id);
			return fail(500, {
				success: false,
				message: 'Erro ao popular categorias/perfis padrão. Grupo não foi criado.'
			});
		}

		return { success: true, message: `Grupo "${name}" criado com sucesso` };
	},

	add_member: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const groupId = formData.get('group_id') as string;
		const email = (formData.get('email') as string)?.trim().toLowerCase();

		if (!groupId || !email) {
			return fail(400, { success: false, message: 'Dados incompletos' });
		}

		const isAdmin = await isHouseholdAdmin(supabase, groupId, user.id);
		if (!isAdmin) {
			return fail(403, { success: false, message: 'Apenas administradores podem adicionar membros' });
		}

		const { data: usersList } = await supabaseAdmin.auth.admin.listUsers();
		const targetUser = usersList?.users?.find((u) => u.email?.toLowerCase() === email);

		if (!targetUser) {
			return fail(404, { success: false, message: `Usuário com email "${email}" não encontrado. A pessoa precisa criar uma conta primeiro.` });
		}

		const existing = await supabase
			.from('household_members')
			.select('user_id')
			.eq('household_id', groupId)
			.eq('user_id', targetUser.id)
			.maybeSingle();

		if (existing.data) {
			return fail(400, { success: false, message: 'Este usuário já é membro do grupo' });
		}

		const { error } = await supabaseAdmin
			.from('household_members')
			.insert({ household_id: groupId, user_id: targetUser.id, role: 'member' });

		if (error) {
			return fail(500, { success: false, message: error.message });
		}

		return { success: true, message: `${email} adicionado ao grupo` };
	},

	remove_member: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const groupId = formData.get('group_id') as string;
		const userId = formData.get('user_id') as string;

		if (!groupId || !userId) {
			return fail(400, { success: false, message: 'Dados incompletos' });
		}

		if (userId === user.id) {
			return fail(400, { success: false, message: 'Você não pode remover a si mesmo. Delete o grupo se deseja sair.' });
		}

		const isAdmin = await isHouseholdAdmin(supabase, groupId, user.id);
		if (!isAdmin) {
			return fail(403, { success: false, message: 'Apenas administradores podem remover membros' });
		}

		const { error } = await supabaseAdmin
			.from('household_members')
			.delete()
			.eq('household_id', groupId)
			.eq('user_id', userId);

		if (error) {
			return fail(500, { success: false, message: error.message });
		}

		return { success: true, message: 'Membro removido' };
	}
};
