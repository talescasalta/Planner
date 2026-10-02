import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import { supabaseAdmin } from '$lib/server/supabase';
import {
	READABLE_ACCESS_EMBED,
	filterByReadableAccess
} from '$lib/server/access';

// The counter is decoration on the navigation: any failure yields null so the
// app never breaks because of it.
async function loadReviewCount(
	supabase: App.Locals['supabase'],
	userId: string
): Promise<number | null> {
	try {
		const householdId = await getUserHouseholdId(supabase, userId);
		if (!householdId) return null;
		const { count, error } = await filterByReadableAccess(
			supabaseAdmin
				.from('transactions')
				.select(`id, ${READABLE_ACCESS_EMBED}`, {
					count: 'exact',
					head: true
				})
				.eq('household_id', householdId),
			userId
		).eq('review_status', 'needs_review');
		return error ? null : (count ?? null);
	} catch {
		return null;
	}
}

export const load: LayoutServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const { session, user, profile } = await safeGetSession();
	if (!session || !user) {
		redirect(303, '/login');
	}
	const reviewCount = await loadReviewCount(supabase, user.id);
	return { session, user, profile, reviewCount };
};
