import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/**/*.{ts,svelte}'],
			exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/app.d.ts'],
			reporter: ['text', 'html', 'json', 'lcov'],
			thresholds: {
				statements: 7,
				branches: 7,
				functions: 8,
				lines: 8
			}
		}
	}
});
