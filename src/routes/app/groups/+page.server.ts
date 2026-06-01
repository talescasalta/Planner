import type { PageServerLoad, Actions } from './$types';
import { supabaseAdmin } from '$lib/server/supabase';
import { seedDefaultCategories, seedDefaultFinancialProfiles } from '$lib/server/household';
import { canEditTransaction, getReadableTransactionIds, isHouseholdAdmin } from '$lib/server/access';
import { findAuthUserByEmail } from '$lib/server/auth-admin';
import { fail, redirect } from '@sveltejs/kit';

type SplitMethod = 'income_proportional' | 'equal';

type MemberContribution = {
	user_id: string;
	display_name: string;
	monthly_income: number;
	income_share: number;
	expense_total: number;
	credit_total: number;
	owed_total: number;
	net_total: number;
	count: number;
	share: number;
};

type SettlementTransfer = {
	from_user_id: string;
	from_name: string;
	to_user_id: string;
	to_name: string;
	amount: number;
};

type GroupTransaction = {
	id: string;
	date: string;
	description: string;
	amount: number;
	currency: string | null;
	category_name: string | null;
	subcategory_name: string | null;
	paid_by_user_id: string | null;
	paid_by_display_name: string | null;
	split_method: SplitMethod;
};

type GroupActivity = {
	monthOptions: string[];
	selectedMonth: string;
	summary: { count: number; expenses: number; credits: number; balance: number };
	contributions: MemberContribution[];
	settlementTransfers: SettlementTransfer[];
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
		contributions: [],
		settlementTransfers: [],
		transactions: []
	};
}

function simplifyTransfers(contributions: MemberContribution[]): SettlementTransfer[] {
	const debtors = contributions
		.filter((member) => member.net_total < -0.005)
		.map((member) => ({ ...member, remaining: Math.abs(member.net_total) }))
		.sort((a, b) => b.remaining - a.remaining);
	const creditors = contributions
		.filter((member) => member.net_total > 0.005)
		.map((member) => ({ ...member, remaining: member.net_total }))
		.sort((a, b) => b.remaining - a.remaining);
	const transfers: SettlementTransfer[] = [];
	let debtorIndex = 0;
	let creditorIndex = 0;

	while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
		const debtor = debtors[debtorIndex];
		const creditor = creditors[creditorIndex];
		const amount = Math.min(debtor.remaining, creditor.remaining);

		if (amount > 0.005) {
			transfers.push({
				from_user_id: debtor.user_id,
				from_name: debtor.display_name,
				to_user_id: creditor.user_id,
				to_name: creditor.display_name,
				amount
			});
		}

		debtor.remaining -= amount;
		creditor.remaining -= amount;
		if (debtor.remaining <= 0.005) debtorIndex += 1;
		if (creditor.remaining <= 0.005) creditorIndex += 1;
	}

	return transfers;
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
					.select('user_id, role, monthly_income, created_at')
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
							monthly_income: Number(m.monthly_income ?? 0),
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

				const [{ data: amountRows }, { data: txRows }] = await Promise.all([
					(() => {
						let q = supabaseAdmin
							.from('transactions')
							.select('amount, paid_by_user_id, split_method')
							.eq('household_id', group.id)
							.in('id', readableTransactionIds)
							.in('owner_profile_id', sharedProfileIds)
							.neq('review_status', 'ignored');
						if (selectedMonth) q = q.eq('reference_month', selectedMonth);
						return q;
					})(),
					(() => {
						let q = supabaseAdmin
							.from('transactions')
							.select(`
								id,
								date,
								description,
								amount,
								currency,
								paid_by_user_id,
								split_method,
								category:categories!transactions_category_id_fkey ( name ),
								subcategory:categories!transactions_subcategory_id_fkey ( name )
							`)
							.eq('household_id', group.id)
							.in('id', readableTransactionIds)
							.in('owner_profile_id', sharedProfileIds)
							.neq('review_status', 'ignored')
							.order('date', { ascending: false });
						if (selectedMonth) q = q.eq('reference_month', selectedMonth);
						return q;
					})()
				]);
				const amounts = amountRows ?? [];
				const transactions: GroupTransaction[] = (txRows ?? []).map((t) => {
					const rawCat = t.category as unknown as { name: string | null } | { name: string | null }[] | null;
					const rawSub = t.subcategory as unknown as { name: string | null } | { name: string | null }[] | null;
					const cat = Array.isArray(rawCat) ? rawCat[0] ?? null : rawCat;
					const sub = Array.isArray(rawSub) ? rawSub[0] ?? null : rawSub;
					return {
						id: t.id,
						date: t.date,
						description: t.description,
						amount: Number(t.amount),
						currency: t.currency,
						category_name: cat?.name ?? null,
						subcategory_name: sub?.name ?? null,
						paid_by_user_id: t.paid_by_user_id,
						paid_by_display_name: t.paid_by_user_id ? displayNameByUserId.get(t.paid_by_user_id) ?? 'Sem nome' : null,
						split_method: (t.split_method ?? 'income_proportional') as SplitMethod
					};
				});

				const expenses = amounts.filter((r) => Number(r.amount) < 0).reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
				const credits = amounts.filter((r) => Number(r.amount) > 0).reduce((s, r) => s + Number(r.amount), 0);
				const balance = amounts.reduce((s, r) => s + Number(r.amount), 0);

				// Aggregate per payer
				const memberIds = (members ?? []).map((member) => member.user_id);
				const incomeByUserId = new Map(
					(members ?? []).map((member) => [member.user_id, Math.max(0, Number(member.monthly_income ?? 0))])
				);
				const totalIncome = memberIds.reduce((sum, userId) => sum + (incomeByUserId.get(userId) ?? 0), 0);
				const fallbackShare = memberIds.length > 0 ? 1 / memberIds.length : 0;
				const byPayer = new Map<string, { expense: number; credit: number; count: number }>();
				const owedByUserId = new Map(memberIds.map((userId) => [userId, 0]));

				for (const row of amounts) {
					const key = row.paid_by_user_id ?? 'unknown';
					const bucket = byPayer.get(key) ?? { expense: 0, credit: 0, count: 0 };
					const amt = Number(row.amount);
					if (amt < 0) bucket.expense += Math.abs(amt);
					else bucket.credit += amt;
					bucket.count += 1;
					byPayer.set(key, bucket);

					if (amt < 0 && memberIds.length > 0) {
						const expense = Math.abs(amt);
						const splitMethod = (row.split_method ?? 'income_proportional') as SplitMethod;
						for (const userId of memberIds) {
							const share =
								splitMethod === 'equal' || totalIncome === 0
									? fallbackShare
									: (incomeByUserId.get(userId) ?? 0) / totalIncome;
							owedByUserId.set(userId, (owedByUserId.get(userId) ?? 0) + expense * share);
						}
					}
				}

				const contributions: MemberContribution[] = (members ?? []).map((m) => {
					const bucket = byPayer.get(m.user_id) ?? { expense: 0, credit: 0, count: 0 };
					const monthlyIncome = Math.max(0, Number(m.monthly_income ?? 0));
					const owedTotal = owedByUserId.get(m.user_id) ?? 0;
					return {
						user_id: m.user_id,
						display_name:
							displayNameByUserId.get(m.user_id) ??
							(m.user_id === user.id ? profile?.display_name ?? user.email ?? 'Você' : 'Sem nome'),
						monthly_income: monthlyIncome,
						income_share: totalIncome > 0 ? (monthlyIncome / totalIncome) * 100 : 0,
						expense_total: bucket.expense,
						credit_total: bucket.credit,
						owed_total: owedTotal,
						net_total: bucket.expense - owedTotal,
						count: bucket.count,
						share: expenses > 0 ? (bucket.expense / expenses) * 100 : 0
					};
				});
				// Include any payer that isn't currently a member (left the group but txs remain).
				for (const [userId, bucket] of byPayer.entries()) {
					if (userId === 'unknown') continue;
					if (contributions.some((c) => c.user_id === userId)) continue;
					contributions.push({
						user_id: userId,
						display_name: displayNameByUserId.get(userId) ?? 'Ex-membro',
						monthly_income: 0,
						income_share: 0,
						expense_total: bucket.expense,
						credit_total: bucket.credit,
						owed_total: 0,
						net_total: bucket.expense,
						count: bucket.count,
						share: expenses > 0 ? (bucket.expense / expenses) * 100 : 0
					});
				}

				activity = {
					monthOptions,
					selectedMonth,
					summary: { count: amounts.length, expenses, credits, balance },
					contributions,
					settlementTransfers: simplifyTransfers(contributions),
					transactions
				};
			}

		return {
			...group,
			members: (members ?? []).map((m) => ({
				user_id: m.user_id,
				role: m.role,
				monthly_income: Number(m.monthly_income ?? 0),
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
	update_incomes: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const groupId = String(formData.get('group_id') ?? '').trim();
		const userIds = formData.getAll('user_id').map((value) => String(value).trim());
		const incomes = formData.getAll('monthly_income').map((value) => Number(String(value).replace(',', '.')));

		if (!groupId || userIds.length === 0 || userIds.length !== incomes.length) {
			return fail(400, { success: false, message: 'Dados de renda incompletos' });
		}
		if (new Set(userIds).size !== userIds.length) {
			return fail(400, { success: false, message: 'Membro duplicado no envio de renda' });
		}

		const isMember = await supabase
			.from('household_members')
			.select('user_id')
			.eq('household_id', groupId)
			.eq('user_id', user.id)
			.maybeSingle();
		if (isMember.error || !isMember.data) {
			return fail(403, { success: false, message: 'Sem permissão para editar este grupo' });
		}

		const { data: groupMembers, error: membersError } = await supabaseAdmin
			.from('household_members')
			.select('user_id')
			.eq('household_id', groupId);
		if (membersError) return fail(500, { success: false, message: membersError.message });

		const groupMemberIds = new Set((groupMembers ?? []).map((member) => member.user_id));
		if (userIds.some((userId) => !groupMemberIds.has(userId))) {
			return fail(400, { success: false, message: 'Renda enviada para membro inválido' });
		}

		const incomeUpdates: Array<{ userId: string; monthlyIncome: number }> = [];
		for (let i = 0; i < userIds.length; i += 1) {
			const monthlyIncome = incomes[i];
			if (!Number.isFinite(monthlyIncome) || monthlyIncome < 0) {
				return fail(400, { success: false, message: 'Informe rendas válidas e positivas' });
			}

			incomeUpdates.push({ userId: userIds[i], monthlyIncome });
		}

		const incomeResults = await Promise.all(
			incomeUpdates.map(({ userId, monthlyIncome }) =>
				supabaseAdmin
					.from('household_members')
					.update({ monthly_income: monthlyIncome })
					.eq('household_id', groupId)
					.eq('user_id', userId)
			)
		);
		const incomeError = incomeResults.find((result) => result.error)?.error;
		if (incomeError) return fail(500, { success: false, message: incomeError.message });

		return { success: true, message: 'Rendas atualizadas' };
	},

	update_split_method: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const groupId = String(formData.get('group_id') ?? '').trim();
		const transactionId = String(formData.get('transaction_id') ?? '').trim();
		const splitMethod = String(formData.get('split_method') ?? '').trim() as SplitMethod;

		if (!groupId || !transactionId || !['income_proportional', 'equal'].includes(splitMethod)) {
			return fail(400, { success: false, message: 'Regra de divisão inválida' });
		}

		const canEdit = await canEditTransaction(supabase, transactionId, user.id);
		if (!canEdit) {
			return fail(403, { success: false, message: 'Sem permissão para editar essa transação' });
		}

		const { data: transaction, error: transactionError } = await supabaseAdmin
			.from('transactions')
			.select('amount, owner_profile:financial_profiles!transactions_owner_profile_id_fkey ( type )')
			.eq('id', transactionId)
			.eq('household_id', groupId)
			.maybeSingle();

		if (transactionError) return fail(500, { success: false, message: transactionError.message });
		if (!transaction) return fail(404, { success: false, message: 'Transação não encontrada' });

		const ownerProfile = Array.isArray(transaction.owner_profile)
			? transaction.owner_profile[0]
			: transaction.owner_profile;

		if (Number(transaction.amount) >= 0 || ownerProfile?.type !== 'shared') {
			return fail(400, { success: false, message: 'A divisão só se aplica a despesas compartilhadas' });
		}

		const { error } = await supabaseAdmin
			.from('transactions')
			.update({ split_method: splitMethod, updated_at: new Date().toISOString() })
			.eq('id', transactionId)
			.eq('household_id', groupId);

		if (error) return fail(500, { success: false, message: error.message });
		return { success: true, message: 'Divisão atualizada' };
	},

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
