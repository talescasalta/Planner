import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import type { OnboardingFacts } from '$lib/onboarding';

// Callers resolve householdId from the session first; this only counts.
// The checklist is a convenience, so any failed read hides it (null) rather
// than breaking the dashboard.
export async function loadOnboardingFacts(
	db: SupabaseClient<Database>,
	householdId: string | null
): Promise<OnboardingFacts | null> {
	if (!householdId) {
		return {
			hasGroup: false,
			hasOwnNames: false,
			transactionCount: 0,
			memberCount: 0,
			membersWithIncome: 0
		};
	}

	try {
		return await countOnboardingFacts(db, householdId);
	} catch {
		return null;
	}
}

async function countOnboardingFacts(
	db: SupabaseClient<Database>,
	householdId: string
): Promise<OnboardingFacts | null> {
	const [household, members, transactions] = await Promise.all([
		db
			.from('households')
			.select('own_account_names')
			.eq('id', householdId)
			.maybeSingle(),
		db
			.from('household_members')
			.select('monthly_income')
			.eq('household_id', householdId),
		db
			.from('transactions')
			.select('id', { count: 'exact', head: true })
			.eq('household_id', householdId)
	]);
	if (household.error || members.error || transactions.error) return null;

	const memberRows = members.data ?? [];
	return {
		hasGroup: true,
		hasOwnNames: (household.data?.own_account_names ?? []).length > 0,
		transactionCount: transactions.count ?? 0,
		memberCount: memberRows.length,
		membersWithIncome: memberRows.filter(
			(member) => Number(member.monthly_income) > 0
		).length
	};
}
