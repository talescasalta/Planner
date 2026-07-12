import type { KnipConfig } from 'knip';

// Relatório informativo de código morto (quality:deadcode). O compiler de
// Svelte abaixo extrai só os imports — suficiente para o grafo de módulos.
// jscpd é executado por caminho de arquivo em scripts/check-duplication.mjs e
// tailwindcss entra via @tailwindcss/vite, então ambos são falsos positivos.
const config: KnipConfig = {
	entry: ['src/routes/**/+*.{ts,svelte}', 'scripts/*.mjs'],
	project: ['src/**/*.{ts,svelte}', 'scripts/**/*.mjs'],
	ignoreDependencies: ['jscpd', 'tailwindcss'],
	compilers: {
		svelte: (text: string) =>
			[...text.matchAll(/import[^;]+/g)].map((match) => match[0]).join('\n')
	}
};

export default config;
