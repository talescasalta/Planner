import type { LayoutServerLoad } from './$types';
import { getUserHouseholdId } from '$lib/server/household';
import {
	buildOverview,
	EMPTY_OVERVIEW,
	loadInvestmentRows
} from '$lib/server/investment-overview';

// Runs once per full page load (it reads nothing from the URL, so switching
// tabs client-side does not repeat it) and feeds the summary strip that every
// tab shows under the navigation.
export const load: LayoutServerLoad = async ({
	locals: { supabase, safeGetSession }
}) => {
	const { user } = await safeGetSession();
	if (!user) return { overview: EMPTY_OVERVIEW };
	const householdId = await getUserHouseholdId(supabase, user.id);
	if (!householdId) return { overview: EMPTY_OVERVIEW };

	const rows = await loadInvestmentRows(supabase, householdId);
	if (rows.assets.length === 0) return { overview: EMPTY_OVERVIEW };

	const today = new Date().toISOString().slice(0, 10);
	return { overview: await buildOverview(rows, today) };
};
