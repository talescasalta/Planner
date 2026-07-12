import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const result = spawnSync(
	process.execPath,
	[resolve(root, 'node_modules/jscpd/run-jscpd.js'), '--config', '.jscpd.json'],
	{
		cwd: root,
		stdio: 'inherit'
	}
);

if (result.error) {
	console.error(`Não foi possível executar jscpd: ${result.error.message}`);
	process.exitCode = 1;
} else if (result.status !== 0) {
	process.exitCode = result.status ?? 1;
} else {
	const report = JSON.parse(
		readFileSync(resolve(root, 'reports/jscpd/jscpd-report.json'), 'utf8')
	);
	const globalPercentage = report.statistics.total.percentage;
	const typescriptPercentage =
		report.statistics.formats.typescript?.percentage ?? 0;
	console.log(
		`Duplicação global: ${globalPercentage.toFixed(2)}% (baseline de referência: 3,58%; limite: 4%)`
	);
	console.log(
		`Baseline TypeScript: ${typescriptPercentage.toFixed(2)}% (referência: 5,05%; informativo; sem gate por linguagem)`
	);
}
