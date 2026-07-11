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
type GroupSummaryRow = { amount: number; paid_by_user_id: string | null; split_method: string | null };
type GroupMemberRow = { user_id: string; role: string; monthly_income: number | null; created_at: string };
type GroupIdentity = { id: string; name: string; created_at: string; role: string };

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

function memberDisplayName(
	userId: string,
	displayNames: Map<string, string | null>,
	currentUserId: string,
	currentUserName: string
) {
	return displayNames.get(userId) ?? (userId === currentUserId ? currentUserName : 'Sem nome');
}

function formatGroupMembers(
	members: GroupMemberRow[],
	displayNames: Map<string, string | null>,
	currentUserId: string,
	currentUserName: string
) {
	return members.map((member) => ({
		user_id: member.user_id,
		role: member.role,
		monthly_income: Number(member.monthly_income ?? 0),
		display_name: memberDisplayName(member.user_id, displayNames, currentUserId, currentUserName)
	}));
}

function summarizeGroupRows(rows: GroupSummaryRow[]) {
	const expenses = rows.filter((row) => Number(row.amount) < 0).reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
	const credits = rows.filter((row) => Number(row.amount) > 0).reduce((sum, row) => sum + Number(row.amount), 0);
	return { count: rows.length, expenses, credits, balance: rows.reduce((sum, row) => sum + Number(row.amount), 0) };
}

function contributionShare(
	row: GroupSummaryRow,
	userId: string,
	totalIncome: number,
	fallbackShare: number,
	incomeByUserId: Map<string, number>
) {
	if (row.split_method === 'equal' || totalIncome === 0) return fallbackShare;
	return (incomeByUserId.get(userId) ?? 0) / totalIncome;
}

function calculateContributionState(rows: GroupSummaryRow[], members: GroupMemberRow[]) {
	const memberIds = members.map((member) => member.user_id);
	const incomeByUserId = new Map(members.map((member) => [member.user_id, Math.max(0, Number(member.monthly_income ?? 0))]));
	const totalIncome = memberIds.reduce((sum, userId) => sum + (incomeByUserId.get(userId) ?? 0), 0);
	const fallbackShare = memberIds.length > 0 ? 1 / memberIds.length : 0;
	const byPayer = new Map<string, { expense: number; credit: number; count: number }>();
	const owedByUserId = new Map(memberIds.map((userId) => [userId, 0]));
	for (const row of rows) {
		const key = row.paid_by_user_id ?? 'unknown';
		const bucket = byPayer.get(key) ?? { expense: 0, credit: 0, count: 0 };
		const amount = Number(row.amount);
		if (amount < 0) bucket.expense += Math.abs(amount);
		else bucket.credit += amount;
		bucket.count += 1;
		byPayer.set(key, bucket);
		if (amount >= 0 || memberIds.length === 0) continue;
		const expense = Math.abs(amount);
		for (const userId of memberIds) {
			const share = contributionShare(row, userId, totalIncome, fallbackShare, incomeByUserId);
			owedByUserId.set(userId, (owedByUserId.get(userId) ?? 0) + expense * share);
		}
	}
	return { byPayer, owedByUserId, incomeByUserId, totalIncome };
}

function buildContributions(
	rows: GroupSummaryRow[],
	members: GroupMemberRow[],
	displayNames: Map<string, string | null>,
	currentUserId: string,
	currentUserName: string,
	totalExpenses: number
) {
	const { byPayer, owedByUserId, incomeByUserId, totalIncome } = calculateContributionState(rows, members);
	const contributions: MemberContribution[] = members.map((member) => {
		const bucket = byPayer.get(member.user_id) ?? { expense: 0, credit: 0, count: 0 };
		const monthlyIncome = incomeByUserId.get(member.user_id) ?? 0;
		const owedTotal = owedByUserId.get(member.user_id) ?? 0;
		return {
			user_id: member.user_id,
			display_name: memberDisplayName(member.user_id, displayNames, currentUserId, currentUserName),
			monthly_income: monthlyIncome,
			income_share: totalIncome > 0 ? (monthlyIncome / totalIncome) * 100 : 0,
			expense_total: bucket.expense,
			credit_total: bucket.credit,
			owed_total: owedTotal,
			net_total: bucket.expense - owedTotal,
			count: bucket.count,
			share: totalExpenses > 0 ? (bucket.expense / totalExpenses) * 100 : 0
		};
	});
	for (const [userId, bucket] of byPayer) {
		if (userId === 'unknown' || contributions.some((member) => member.user_id === userId)) continue;
		contributions.push({
			user_id: userId, display_name: displayNames.get(userId) ?? 'Ex-membro', monthly_income: 0,
			income_share: 0, expense_total: bucket.expense, credit_total: bucket.credit, owed_total: 0,
			net_total: bucket.expense, count: bucket.count,
			share: totalExpenses > 0 ? (bucket.expense / totalExpenses) * 100 : 0
		});
	}
	return contributions;
}

function mapGroupTransactions(
	rows: Array<Record<string, unknown>>,
	displayNames: Map<string, string | null>
): GroupTransaction[] {
	return rows.map((row) => {
		const rawCategory = row.category as { name: string | null } | { name: string | null }[] | null;
		const rawSubcategory = row.subcategory as { name: string | null } | { name: string | null }[] | null;
		const category = Array.isArray(rawCategory) ? rawCategory[0] ?? null : rawCategory;
		const subcategory = Array.isArray(rawSubcategory) ? rawSubcategory[0] ?? null : rawSubcategory;
		const payerId = row.paid_by_user_id as string | null;
		return {
			id: String(row.id), date: String(row.date), description: String(row.description), amount: Number(row.amount),
			currency: row.currency as string | null, category_name: category?.name ?? null,
			subcategory_name: subcategory?.name ?? null, paid_by_user_id: payerId,
			paid_by_display_name: payerId ? displayNames.get(payerId) ?? 'Sem nome' : null,
			split_method: (row.split_method ?? 'income_proportional') as SplitMethod
		};
	});
}

async function loadGroupActivity(
	groupId: string,
	readableTransactionIds: string[],
	sharedProfileIds: string[],
	members: GroupMemberRow[],
	displayNames: Map<string, string | null>,
	currentUserId: string,
	currentUserName: string,
	url: URL
): Promise<GroupActivity> {
	if (readableTransactionIds.length === 0 || sharedProfileIds.length === 0) return emptyGroupActivity();
	const { data: monthRows } = await supabaseAdmin
		.from('transactions')
		.select('reference_month, date')
		.eq('household_id', groupId)
		.in('id', readableTransactionIds)
		.in('owner_profile_id', sharedProfileIds)
		.neq('review_status', 'ignored')
		.order('reference_month', { ascending: false, nullsFirst: false })
		.order('date', { ascending: false });
	const monthOptions = Array.from(
		new Set((monthRows ?? []).map((row) => row.reference_month ?? monthFromDate(row.date)).filter(Boolean))
	).sort((left, right) => right.localeCompare(left));
	const selectedMonth = url.searchParams.get(`month_${groupId}`) ?? url.searchParams.get('month') ?? monthOptions[0] ?? '';

	let amountQuery = supabaseAdmin.from('transactions').select('amount, paid_by_user_id, split_method')
		.eq('household_id', groupId).in('id', readableTransactionIds).in('owner_profile_id', sharedProfileIds)
		.neq('review_status', 'ignored');
	let transactionQuery = supabaseAdmin.from('transactions').select(`
		id, date, description, amount, currency, paid_by_user_id, split_method,
		category:categories!transactions_category_id_fkey ( name ),
		subcategory:categories!transactions_subcategory_id_fkey ( name )
	`).eq('household_id', groupId).in('id', readableTransactionIds).in('owner_profile_id', sharedProfileIds)
		.neq('review_status', 'ignored').order('date', { ascending: false });
	if (selectedMonth) {
		amountQuery = amountQuery.eq('reference_month', selectedMonth);
		transactionQuery = transactionQuery.eq('reference_month', selectedMonth);
	}
	const [{ data: amountRows }, { data: transactionRows }] = await Promise.all([amountQuery, transactionQuery]);
	const rows = (amountRows ?? []) as GroupSummaryRow[];
	const summary = summarizeGroupRows(rows);
	const contributions = buildContributions(
		rows, members, displayNames, currentUserId, currentUserName, summary.expenses
	);
	return {
		monthOptions,
		selectedMonth,
		summary,
		contributions,
		settlementTransfers: simplifyTransfers(contributions),
		transactions: mapGroupTransactions((transactionRows ?? []) as unknown as Array<Record<string, unknown>>, displayNames)
	};
}

async function loadGroupDetails(
	group: GroupIdentity,
	readableTransactionIds: string[],
	currentUserId: string,
	currentUserName: string,
	url: URL
) {
	const [{ data: memberData }, { data: sharedProfiles }] = await Promise.all([
		supabaseAdmin.from('household_members').select('user_id, role, monthly_income, created_at')
			.eq('household_id', group.id).order('created_at'),
		supabaseAdmin.from('financial_profiles').select('id').eq('household_id', group.id).eq('type', 'shared')
	]);
	const members = (memberData ?? []) as GroupMemberRow[];
	const memberUserIds = members.map((member) => member.user_id);
	const { data: profiles } = memberUserIds.length > 0
		? await supabaseAdmin.from('profiles').select('user_id, display_name').in('user_id', memberUserIds)
		: { data: [] };
	const displayNames = new Map((profiles ?? []).map((profile) => [profile.user_id, profile.display_name]));
	const activity = await loadGroupActivity(
		group.id, readableTransactionIds, (sharedProfiles ?? []).map((profile) => profile.id), members,
		displayNames, currentUserId, currentUserName, url
	);
	return {
		...group,
		members: formatGroupMembers(members, displayNames, currentUserId, currentUserName),
		activity
	};
}

function readIncomeUpdates(formData: FormData) {
	const groupId = String(formData.get('group_id') ?? '').trim();
	const userIds = formData.getAll('user_id').map((value) => String(value).trim());
	const incomes = formData.getAll('monthly_income').map((value) => Number(String(value).replace(',', '.')));
	return { groupId, userIds, incomes };
}

function validIncomeUpdates(userIds: string[], incomes: number[]) {
	return userIds.map((userId, index) => ({ userId, monthlyIncome: incomes[index] }))
		.filter(({ monthlyIncome }) => Number.isFinite(monthlyIncome) && monthlyIncome >= 0);
}

function readSplitUpdate(formData: FormData) {
	return {
		groupId: String(formData.get('group_id') ?? '').trim(),
		transactionId: String(formData.get('transaction_id') ?? '').trim(),
		splitMethod: String(formData.get('split_method') ?? '').trim() as SplitMethod
	};
}

function incomeFormError(groupId: string, userIds: string[], incomes: number[]) {
	if (!groupId || userIds.length === 0 || userIds.length !== incomes.length) return 'Dados de renda incompletos';
	if (new Set(userIds).size !== userIds.length) return 'Membro duplicado no envio de renda';
	return null;
}

function validSplitUpdate(groupId: string, transactionId: string, splitMethod: SplitMethod) {
	return !!groupId && !!transactionId && ['income_proportional', 'equal'].includes(splitMethod);
}

function isSharedExpense(transaction: { amount: number; owner_profile: { type?: string } | { type?: string }[] | null }) {
	const profile = Array.isArray(transaction.owner_profile) ? transaction.owner_profile[0] : transaction.owner_profile;
	return Number(transaction.amount) < 0 && profile?.type === 'shared';
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
	const currentUserName = profile?.display_name ?? user.email ?? 'Você';
	const groupsWithMembers = await Promise.all(
		groups.map((group) => loadGroupDetails(group, readableTransactionIds, user.id, currentUserName, url))
	);

	return { groups: groupsWithMembers, user };
};

export const actions: Actions = {
	update_incomes: async ({ request, locals: { supabase, safeGetSession } }) => {
		const { user } = await safeGetSession();
		if (!user) return fail(401, { success: false, message: 'Não autenticado' });

		const formData = await request.formData();
		const { groupId, userIds, incomes } = readIncomeUpdates(formData);

		const formError = incomeFormError(groupId, userIds, incomes);
		if (formError) return fail(400, { success: false, message: formError });

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

		const incomeUpdates = validIncomeUpdates(userIds, incomes);
		if (incomeUpdates.length !== userIds.length) {
			return fail(400, { success: false, message: 'Informe rendas válidas e positivas' });
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
		const { groupId, transactionId, splitMethod } = readSplitUpdate(formData);

		if (!validSplitUpdate(groupId, transactionId, splitMethod)) {
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

		if (!isSharedExpense(transaction)) {
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
