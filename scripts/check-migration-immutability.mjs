import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MIGRATIONS_PATH = 'supabase/migrations';

function git(args, cwd = ROOT) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
	if (result.error)
		throw new Error(`Não foi possível executar git: ${result.error.message}`);
	return result;
}

function baseCandidates() {
	const explicit = process.env.MIGRATION_BASE_REF;
	const githubBase = process.env.GITHUB_BASE_REF
		? `origin/${process.env.GITHUB_BASE_REF}`
		: undefined;
	return [explicit, githubBase, 'origin/main', 'main'].filter(Boolean);
}

function resolveBaseRef() {
	for (const candidate of baseCandidates()) {
		const result = git(['rev-parse', '--verify', `${candidate}^{commit}`]);
		if (result.status === 0) return candidate;
	}
	return null;
}

export function changedAppliedMigrations({
	baseRef = resolveBaseRef(),
	headRef = 'HEAD'
} = {}) {
	if (!baseRef) return { baseRef: null, paths: [] };
	const result = git([
		'diff',
		'--name-status',
		'--no-renames',
		'--diff-filter=MD',
		`${baseRef}...${headRef}`,
		'--',
		MIGRATIONS_PATH
	]);
	if (result.status !== 0) {
		throw new Error(
			`Não foi possível comparar migrations com ${baseRef}: ${(result.stderr || result.stdout).trim()}`
		);
	}

	const paths = result.stdout
		.trim()
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => line.split(/\s+/).slice(1).join(' '));
	return { baseRef, paths };
}

export function run() {
	const result = changedAppliedMigrations();
	if (!result.baseRef) {
		if (process.env.CI === 'true') {
			console.error(
				'ERROR: não foi possível resolver a referência base para proteger migrations.'
			);
			return 1;
		}
		console.log(
			'Migration immutability skipped: nenhuma referência base local foi encontrada.'
		);
		return 0;
	}

	if (result.paths.length === 0) {
		console.log(
			`Migration immutability passed against ${result.baseRef}: nenhuma migration aplicada foi alterada ou removida.`
		);
		return 0;
	}

	console.error(
		`ERROR: migrations aplicadas não podem ser alteradas ou removidas (base ${result.baseRef}):`
	);
	for (const path of result.paths) console.error(`- ${path}`);
	return 1;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		process.exitCode = run();
	} catch (error) {
		console.error(`ERROR: ${error.message}`);
		process.exitCode = 1;
	}
}
