import type { User, Session, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

type Profile = {
	id: string;
	user_id: string;
	display_name: string | null;
	created_at: string;
};

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient<Database>;
			safeGetSession(): Promise<{
				session: Session | null;
				user: User | null;
				profile: Profile | null;
			}>;
		}
		interface PageData {
			session: Session | null;
			user: User | null;
			profile: Profile | null;
		}
	}
}

export {};
