import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

type AdminListUsersClient = SupabaseClient<Database> & {
	auth: {
		admin: {
			listUsers: (params?: { page?: number; perPage?: number }) => Promise<{
				data?: { users?: User[] };
				error?: { message: string } | null;
			}>;
		};
	};
};

export async function findAuthUserByEmail(
	supabase: AdminListUsersClient,
	email: string,
	perPage = 100
): Promise<User | null> {
	const normalizedEmail = email.trim().toLowerCase();
	for (let page = 1; page < 1000; page += 1) {
		const { data, error } = await supabase.auth.admin.listUsers({
			page,
			perPage
		});
		if (error) throw new Error(error.message);
		const users = data?.users ?? [];
		const match = users.find((u) => u.email?.toLowerCase() === normalizedEmail);
		if (match) return match;
		if (users.length < perPage) return null;
	}
	return null;
}
