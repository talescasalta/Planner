import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { Handle } from '@sveltejs/kit';
import type { Database } from '$lib/types/database';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				cookiesToSet.forEach(({ name, value, options }) => {
					event.cookies.set(name, value, { ...options, path: '/' });
				});
			}
		}
	});

	event.locals.safeGetSession = async () => {
		// getUser authenticates the JWT against the Supabase Auth server, which
		// is the only safe source of identity on the server. We avoid getSession
		// here because it returns unverified cookie data and triggers a noisy
		// security warning from @supabase/ssr.
		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error || !user) {
			return { session: null, user: null, profile: null };
		}

		const { data: profile } = await event.locals.supabase
			.from('profiles')
			.select('*')
			.eq('user_id', user.id)
			.single();

		// We don't need the full Session object anywhere downstream; callers only
		// branch on truthy/falsy. Hand back a minimal stub that satisfies the type.
		const session = { user } as unknown as import('@supabase/supabase-js').Session;
		return { session, user, profile };
	};

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};
