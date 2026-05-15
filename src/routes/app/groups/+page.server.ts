import type { PageServerLoad, Actions } from './$types';
import { supabaseAdmin } from '$lib/server/supabase';
import { seedDefaultCategories, seedDefaultFinancialProfiles } from '$lib/server/household';
import { getReadableTransactionIds, isHouseholdAdmin } from '$lib/server/access';
import { findAuthUserByEmail } from '$lib/server/auth-admin';
import { fail, redirect } from '@sveltejs/kit';

type GroupTransaction = {
	id: string;
	date: string;
	description: string;
	amount: number;
	currency: string | null;
	reference_month: string | null;
	review_status: string;
	category: { name: string | null } | null;
	subcategory: { name: string | null } | null;
	owner_profile: { name: string | null } | null;
};

type GroupActivity = {
	monthOptions: string[];
	selectedMonth: string;
	summary: { count: number; expenses: number; credits: number; balance: number };
	transactions: GroupTransaction[];
};

type HouseholdJoin = { id: string; name: string; created_at: string };

function monthFromDate(date: string | null | undefined): string {
	return date?.slice(0, 7) ?? '';
}

function emptyGroupActivity(selectedMonth = ''): GroupActivity {
	return {
		monthOptions: [],
		selectedMonth,
		summary: { count: 0, expenses: 0, credits: 0, balance: 0 },
		transactions: []
	};
}

export const load: PageServerLoad = async ({ url, locals: { supabase, safeGetSession } }) => {
	const { user, profile } = await safeGetSession();
	if (!user) redirect(303, '/login');

	const { data: memberships } = await supabase
		.from('household_members')
		.select('household_id, role, households ( id, name, created_at )')
		.eq('user_id', user.id);

	const groups = (memberships ?? []).map((m) => {
		const joinedHouseholds = m.households as unknown as HouseholdJoin | HouseholdJoin[];
		const household = Array.isArray(joinedHouseholds) ? joinedHouseholds[0] : joinedHouseholds;
		return {
			id: household.id,
			name: household.name,
			created_at: household.created_at,
			role: m.role
		};
	});

	const readableTransactionIds = await getReadableTransactionIds(supabase, user.id);
	const groupsWithMembers = await Promise.all(
		groups.map(async (group) => {
			const [{ data: members }, { data: sharedProfiles }] = await Promise.all([
				supabaseAdmin
					.from('household_members')
					.select('user_id, role, created_at')
					.eq('household_id', group.id)
					.order('created_at'),
				supabaseAdmin
					.from('financial_profiles')
					.select('id')
					.eq('household_id', group.id)
					.eq('type', 'shared')
			]);

			const memberUserIds = (members ?? []).map((member) => member.user_id);
			const { data: memberProfiles } =
				memberUserIds.length > 0
					? await supabaseAdmin.from('profiles').select('user_id, display_name').in('user_id', memberUserIds)
					: { data: [] };
			const displayNameByUserId = new Map((memberProfiles ?? []).map((p) => [p.user_id, p.display_name]));

			let activity: GroupActivity = emptyGroupActivity();
			if (readableTransactionIds.length > 0) {
				const sharedProfileIds = (sharedProfiles ?? []).map((profile) => profile.id);

				if (sharedProfileIds.length === 0) {
					return {
						...group,
						members: (members ?? []).map((m) => ({
							user_id: m.user_id,
							role: m.role,
							display_name:
								displayNameByUserId.get(m.user_id) ??
								(m.user_id === user.id ? profile?.display_name ?? user.email ?? 'Você' : 'Sem nome')
						})),
						activity
					};
				}

				const { data: monthRows } = await supabaseAdmin
					.from('transactions')
					.select('reference_month, date')
					.eq('household_id', group.id)
					.in('id', readableTransactionIds)
					.in('owner_profile_id', sharedProfileIds)
					.neq('review_status', 'ignored')
					.order('reference_month', { ascending: false, nullsFirst: false })
					.order('date', { ascending: false });
				const monthOptions = Array.from(
					new Set((monthRows ?? []).map((row) => row.reference_month ?? monthFromDate(row.date)).filter(Boolean))
				).sort((a, b) => b.localeCompare(a));
				const selectedMonth = url.searchParams.get(`month_${group.id}`) ?? url.searchParams.get('month') ?? monthOptions[0] ?? '';

				const [{ data: transactionRows }, { data: amountRows }] = await Promise.all([
					(() => {
						let query = supabaseAdmin
							.from('transactions')
							.select(`
							id,
							date,
							description,
							amount,
							currency,
							reference_month,
							review_status,
							category:categories!transactions_category_id_fkey ( name ),
							subcategory:categories!transactions_subcategory_id_fkey ( name ),
							owner_profile:financial_profiles ( name )
						`)
							.eq('household_id', group.id)
							.in('id', readableTransactionIds)
							.in('owner_profile_id', sharedProfileIds)
							.neq('review_status', 'ignored')
							.order('date', { ascending: false })
							.limit(25);
						if (selectedMonth) query = query.eq('reference_month', selectedMonth);
						return query;
					})(),
					(() => {
						let query = supabaseAdmin
							.from('transactions')
							.select('amount')
							.eq('household_id', group.id)
							.in('id', readableTransactionIds)
							.neq('review_status', 'ignored');
						query = query.in('owner_profile_id', sharedProfileIds);
						if (selectedMonth) query = query.eq('reference_month', selectedMonth);
						return query;
					})()
				]);

				const amounts = amountRows ?? [];
				activity = {
					monthOptions,
					selectedMonth,
					summary: {
						count: amounts.length,
						expenses: amounts.filter((row) => Number(row.amount) < 0).reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0),
						credits: amounts.filter((row) => Number(row.amount) > 0).reduce((sum, row) => sum + Number(row.amount), 0),
						balance: amounts.reduce((sum, row) => sum + Number(row.amount), 0)
					},
					transactions: (transactionRows ?? []) as unknown as GroupTransaction[]
				};
			}

		return {
			...group,
			members: (members ?? []).map((m) => ({
				user_id: m.user_id,
				role: m.role,
				display_name:
					displayNameByUserId.get(m.user_id) ??
					(m.user_id === user.id ? profile?.display_name ?? user.email ?? 'Você' : 'Sem nome')
			})),
			activity
		};
		})
	);

	return { groups: groupsWithMembers, user };
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

		let targetUser;
		try {
			targetUser = await findAuthUserByEmail(supabaseAdmin, email);
		} catch (e) {
			return fail(500, { success: false, message: String(e) });
		}

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
