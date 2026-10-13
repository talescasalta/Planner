import { createServerClient } from '@supabase/ssr';
import {
	PUBLIC_SUPABASE_URL,
	PUBLIC_SUPABASE_ANON_KEY
} from '$env/static/public';
import type { Handle } from '@sveltejs/kit';
import type { Database } from '$lib/types/database';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient<Database>(
		PUBLIC_SUPABASE_URL,
		PUBLIC_SUPABASE_ANON_KEY,
		{
			cookies: {
				getAll: () => event.cookies.getAll(),
				setAll: (cookiesToSet) => {
					cookiesToSet.forEach(({ name, value, options }) => {
						try {
							event.cookies.set(name, value, { ...options, path: '/' });
						} catch {
							// Supabase auth subscribers may fire after the response is sent
							// (e.g. token refresh on a stale request). Ignoring is safe — the
							// next request will refresh cookies normally.
						}
					});
				}
			}
		}
	);

	// The layout and the page both ask for the session on every navigation;
	// each call costs a round trip to Supabase Auth plus a profile query, so
	// the first result is shared for the rest of the request. A sign-in,
	// sign-out or password change during the request (form actions) drops it.
	let sessionPromise: ReturnType<App.Locals['safeGetSession']> | null = null;
	event.locals.supabase.auth.onAuthStateChange((authEvent) => {
		if (
			authEvent === 'SIGNED_IN' ||
			authEvent === 'SIGNED_OUT' ||
			authEvent === 'USER_UPDATED'
		) {
			sessionPromise = null;
		}
	});

	const loadSession = async () => {
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
		const session = {
			user
		} as unknown as import('@supabase/supabase-js').Session;
		return { session, user, profile };
	};
	event.locals.safeGetSession = () => (sessionPromise ??= loadSession());

	const response = await resolve(event, {
		filterSerializedResponseHeaders(name) {
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set(
		'Permissions-Policy',
		'camera=(), microphone=(), geolocation=()'
	);
	response.headers.set(
		'Strict-Transport-Security',
		'max-age=31536000; includeSubDomains'
	);
	response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

	return response;
};
