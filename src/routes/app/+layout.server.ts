import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({
	locals: { safeGetSession }
}) => {
	const { session, user, profile } = await safeGetSession();
	if (!session || !user) {
		redirect(303, '/login');
	}
	return { session, user, profile };
};
