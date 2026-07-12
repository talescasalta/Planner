import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DETECTED_STATUSES = new Set(['Killed', 'Timeout']);
const SCORED_STATUSES = new Set([
	'Killed',
	'Timeout',
	'Survived',
	'NoCoverage'
]);

/** @typedef {{ status: string }} Mutant */
/** @typedef {{ mutants?: Mutant[] }} FileMutationReport */
/** @typedef {Record<string, FileMutationReport>} FilesMutationReport */
/** @typedef {{ name: string, minimum: number, files: string[] }} MutationModule */
/** @typedef {{ modules: MutationModule[] }} ModuleEvaluationConfig */
/** @typedef {ModuleEvaluationConfig & { report: string }} MutationModuleConfig */
/** @typedef {{ files: FilesMutationReport }} MutationReport */
/** @typedef {MutationModule & { detected: number, total: number, score: number }} MutationModuleResult */

/**
 * @param {FilesMutationReport} filesReport
 * @param {string[]} files
 */
export function calculateModuleScore(filesReport, files) {
	const mutants = files.flatMap((file) => {
		const report = filesReport[file];
		if (!report)
			throw new Error(`Mutation report is missing configured file: ${file}`);
		return report.mutants ?? [];
	});
	const total = mutants.filter((mutant) =>
		SCORED_STATUSES.has(mutant.status)
	).length;
	const detected = mutants.filter((mutant) =>
		DETECTED_STATUSES.has(mutant.status)
	).length;
	return {
		detected,
		total,
		score: total === 0 ? 100 : (detected / total) * 100
	};
}

/**
 * @param {MutationReport} report
 * @param {ModuleEvaluationConfig} config
 * @returns {MutationModuleResult[]}
 */
export function evaluateModules(report, config) {
	return config.modules.map((module) => ({
		...module,
		...calculateModuleScore(report.files, module.files)
	}));
}

function main() {
	const configPath = resolve(process.argv[2] ?? 'mutation-modules.config.json');
	/** @type {MutationModuleConfig} */
	const config = JSON.parse(readFileSync(configPath, 'utf8'));
	/** @type {MutationReport} */
	const report = JSON.parse(readFileSync(resolve(config.report), 'utf8'));
	const results = evaluateModules(report, config);
	console.log('Mutation score by module');
	console.table(
		results.map(({ name, minimum, detected, total, score }) => ({
			module: name,
			score: `${score.toFixed(2)}%`,
			minimum: `${minimum.toFixed(2)}%`,
			detected: `${detected}/${total}`
		}))
	);
	const failed = results.filter((result) => result.score < result.minimum);
	if (failed.length > 0) {
		for (const result of failed) {
			console.error(
				`${result.name}: ${result.score.toFixed(2)}% is below ${result.minimum.toFixed(2)}%`
			);
		}
		process.exitCode = 1;
	}
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main();
