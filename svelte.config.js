import vercelAdapter from '@sveltejs/adapter-vercel';

const adapter =
	process.env.VERCEL || process.env.FORCE_VERCEL_ADAPTER
		? vercelAdapter()
		: {
				name: 'local-validation-adapter',
				adapt(builder) {
					builder.log.minor(
						'Skipping Vercel output locally. Set FORCE_VERCEL_ADAPTER=1 to test it.'
					);
				}
			};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) =>
			filename.split(/[/\\]/).includes('node_modules') ? undefined : true
	},
	kit: {
		adapter,
		csp: {
			directives: {
				'default-src': ['self'],
				// SvelteKit injects nonces/hashes for its own inline scripts.
				'script-src': ['self'],
				// Tailwind/Svelte rely on inline style attributes.
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				'font-src': ['self'],
				'connect-src': ['self', 'https://*.supabase.co'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				// Chrome enforces form-action on redirects that follow a form
				// submission; the login action 303-redirects to Supabase, which
				// then forwards to Google for OAuth.
				'form-action': [
					'self',
					'https://*.supabase.co',
					'https://accounts.google.com'
				]
			}
		}
	}
};

export default config;
