import vercelAdapter from '@sveltejs/adapter-vercel';

const adapter =
	process.env.VERCEL || process.env.FORCE_VERCEL_ADAPTER
		? vercelAdapter()
		: {
				name: 'local-validation-adapter',
				adapt(builder) {
					builder.log.minor('Skipping Vercel output locally. Set FORCE_VERCEL_ADAPTER=1 to test it.');
				}
			};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
	},
	kit: { adapter }
};

export default config;
