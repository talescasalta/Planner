import svelteConfig from './svelte.config.js';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
	{
		ignores: ['.svelte-kit/**', 'build/**', 'coverage/**', 'node_modules/**', 'reports/**']
	},
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	svelte.configs.base,
	{
		files: ['**/*.ts'],
		languageOptions: { parser: ts.parser }
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	{
		files: ['src/**/*.{ts,svelte}'],
		ignores: ['**/*.d.ts', '**/*.test.ts'],
		rules: {
			complexity: ['error', { max: 12, variant: 'modified' }]
		}
	}
);
