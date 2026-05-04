import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { supabaseAdmin } from '$lib/server/supabase';

export interface PayerProfile {
	id: string;
	display_name: string | null;
}

export async function attachPayerProfiles<T extends { paid_by_user_id: string | null }>(
	rows: T[]
): Promise<Array<T & { paid_by: PayerProfile | null }>> {
	const ids = Array.from(new Set(rows.map((r) => r.paid_by_user_id).filter((id): id is string => !!id)));
	const map = new Map<string, PayerProfile>();
	if (ids.length > 0) {
		const { data } = await supabaseAdmin
			.from('profiles')
			.select('id, user_id, display_name')
			.in('user_id', ids);
		for (const p of data ?? []) {
			map.set(p.user_id, { id: p.id, display_name: p.display_name });
		}
	}
	return rows.map((r) => ({
		...r,
		paid_by: r.paid_by_user_id ? map.get(r.paid_by_user_id) ?? null : null
	}));
}

export async function getUserHouseholdId(
	_supabase: SupabaseClient<Database>,
	userId: string
): Promise<string | null> {
	// Use admin client: we already validated the user via safeGetSession upstream;
	// this is just a lookup of "which household does this user_id belong to" and
	// must not depend on per-request RLS context.
	const { data, error } = await supabaseAdmin
		.from('household_members')
		.select('household_id, created_at')
		.eq('user_id', userId)
		.order('created_at', { ascending: true })
		.limit(1);

	if (error || !data || data.length === 0) return null;
	return data[0].household_id;
}

export async function getHouseholdMembers(
	supabase: SupabaseClient<Database>,
	householdId: string
): Promise<string[]> {
	const { data, error } = await supabase
		.from('household_members')
		.select('user_id')
		.eq('household_id', householdId);

	if (error || !data) return [];
	return data.map((m) => m.user_id);
}

export async function seedDefaultCategories(
	supabase: SupabaseClient<Database>,
	householdId: string
): Promise<void> {
	const { error } = await supabase.rpc('seed_default_categories', { p_household_id: householdId });
	if (error) throw new Error(`seed_default_categories: ${error.message}`);
}

export async function seedDefaultFinancialProfiles(
	supabase: SupabaseClient<Database>,
	householdId: string
): Promise<void> {
	const { error } = await supabase.rpc('seed_default_financial_profiles', { p_household_id: householdId });
	if (error) throw new Error(`seed_default_financial_profiles: ${error.message}`);
}
