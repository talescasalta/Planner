import svelteConfig from './svelte.config.js';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
	{
		ignores: [
			'.svelte-kit/**',
			'build/**',
			'coverage/**',
			'node_modules/**',
			'reports/**',
			'.stryker-tmp/**'
		]
	},
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		files: ['**/*.{ts,tsx,mts,cts}'],
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
		files: ['src/**/*.{js,ts,svelte}'],
		ignores: ['**/*.d.ts', '**/*.test.ts'],
		rules: {
			complexity: ['error', { max: 12, variant: 'modified' }]
		}
	},
	{
		files: ['src/**/*.{js,ts,svelte}'],
		ignores: [
			'src/lib/server/**',
			'src/routes/**/+*.server.ts',
			'src/routes/**/+server.ts'
		],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/server', '$lib/server/*', '$lib/server/**'],
							message:
								'Imports de $lib/server/** só podem ser usados no código server-side.'
						}
					]
				}
			]
		}
	}
);
