import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

export async function updateRuleActiveForHousehold(
	supabase: SupabaseClient<Database>,
	householdId: string,
	ruleId: string,
	active: boolean
): Promise<{ error: { message: string } | null }> {
	const { error } = await supabase
		.from('classification_rules')
		.update({ active })
		.eq('id', ruleId)
		.eq('household_id', householdId);
	return { error };
}

export async function deleteRuleForHousehold(
	supabase: SupabaseClient<Database>,
	householdId: string,
	ruleId: string
): Promise<{ error: { message: string } | null }> {
	const { error } = await supabase
		.from('classification_rules')
		.delete()
		.eq('id', ruleId)
		.eq('household_id', householdId);
	return { error };
}
