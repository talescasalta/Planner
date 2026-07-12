import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_EXCEPTIONS_FILE = resolve(
	ROOT,
	'security/dependency-exceptions.json'
);

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const VALID_SEVERITIES = new Set([
	'info',
	'low',
	'moderate',
	'high',
	'critical'
]);

function parseDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return null;
	const date = new Date(`${value}T23:59:59.999Z`);
	return Number.isNaN(date.valueOf()) ? null : date;
}

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		throw new Error(`Não foi possível ler JSON de ${file}: ${error.message}`, {
			cause: error
		});
	}
}

function exceptionPackages(exception) {
	return new Set([
		...(typeof exception.package === 'string' ? [exception.package] : []),
		...(Array.isArray(exception.packages) ? exception.packages : [])
	]);
}

export function validateExceptions(config, now = new Date()) {
	const exceptions = Array.isArray(config) ? config : config?.exceptions;
	if (!Array.isArray(exceptions)) {
		return {
			exceptions: [],
			errors: ['O arquivo de exceções deve conter um array "exceptions".'],
			expired: []
		};
	}

	const errors = [];
	const expired = [];
	for (const [index, exception] of exceptions.entries()) {
		const label = `exceptions[${index}]`;
		if (!exception || typeof exception !== 'object') {
			errors.push(`${label} deve ser um objeto.`);
			continue;
		}
		if (typeof exception.advisory !== 'string' || !exception.advisory.trim()) {
			errors.push(`${label}.advisory é obrigatório.`);
		}
		if (
			typeof exception.justification !== 'string' ||
			!exception.justification.trim()
		) {
			errors.push(`${label}.justification é obrigatório.`);
		}
		if (typeof exception.impact !== 'string' || !exception.impact.trim()) {
			errors.push(`${label}.impact é obrigatório.`);
		}
		if (
			typeof exception.mitigation !== 'string' ||
			!exception.mitigation.trim()
		) {
			errors.push(`${label}.mitigation é obrigatório.`);
		}
		const expiry = parseDate(exception.expires);
		if (!expiry) {
			errors.push(`${label}.expires deve usar a data YYYY-MM-DD.`);
		} else if (expiry < now) {
			expired.push(exception);
		}
		if (
			exception.packages !== undefined &&
			!Array.isArray(exception.packages)
		) {
			errors.push(`${label}.packages deve ser um array quando informado.`);
		}
	}

	return { exceptions, errors, expired };
}

function advisoryDetails(vulnerability) {
	return (Array.isArray(vulnerability?.via) ? vulnerability.via : [])
		.filter((entry) => entry && typeof entry === 'object')
		.map((entry) => ({
			id:
				entry.url?.match(/\/advisories\/([^/]+)/i)?.[1] ??
				String(entry.source ?? ''),
			title: entry.title ?? '',
			url: entry.url ?? ''
		}));
}

function matchesException(exception, finding) {
	if (typeof exception.advisory !== 'string' || !exception.advisory.trim())
		return false;
	if (!finding.advisories.includes(exception.advisory)) return false;
	const packages = exceptionPackages(exception);
	const packageMatches = packages.size === 0 || packages.has(finding.name);
	return packageMatches;
}

export function evaluateAudit(report, config, now = new Date()) {
	const exceptionState = validateExceptions(config, now);
	const exceptions = exceptionState.exceptions;
	const vulnerabilities = report?.vulnerabilities ?? {};
	const findings = Object.entries(vulnerabilities).map(
		([name, vulnerability]) => {
			const details = advisoryDetails(vulnerability);
			const advisories = details.map((entry) => entry.id).filter(Boolean);
			const exception = exceptions.find((candidate) =>
				matchesException(candidate, {
					name,
					advisories
				})
			);
			return {
				name,
				severity: VALID_SEVERITIES.has(vulnerability?.severity)
					? vulnerability.severity
					: 'unknown',
				advisories,
				details,
				exception
			};
		}
	);

	return {
		findings,
		blockingFindings: findings.filter(
			(finding) =>
				BLOCKING_SEVERITIES.has(finding.severity) && !finding.exception
		),
		expiredExceptions: exceptionState.expired,
		configurationErrors: exceptionState.errors
	};
}

export function runNpmAudit(cwd = ROOT) {
	const npmExecPath = process.env.npm_execpath;
	const command = npmExecPath
		? process.execPath
		: process.platform === 'win32'
			? 'npm.cmd'
			: 'npm';
	const args = npmExecPath
		? [npmExecPath, 'audit', '--json']
		: ['audit', '--json'];
	const result = spawnSync(command, args, {
		cwd,
		encoding: 'utf8',
		shell: !npmExecPath && process.platform === 'win32',
		maxBuffer: 10 * 1024 * 1024
	});
	if (result.error)
		throw new Error(
			`Não foi possível executar npm audit: ${result.error.message}`
		);
	let report;
	try {
		report = JSON.parse(result.stdout || '');
	} catch {
		const detail = (result.stderr || result.stdout || '').trim();
		throw new Error(`npm audit não retornou JSON válido. ${detail}`.trim());
	}
	return { report, exitCode: result.status ?? 1 };
}

function formatFinding(finding) {
	const advisory =
		finding.advisories.length > 0 ? ` (${finding.advisories.join(', ')})` : '';
	const exception = finding.exception
		? ` — exceção válida até ${finding.exception.expires}`
		: '';
	return `- ${finding.severity.toUpperCase()}: ${finding.name}${advisory}${exception}`;
}

export function run({
	cwd = ROOT,
	exceptionsFile = DEFAULT_EXCEPTIONS_FILE,
	now = new Date()
} = {}) {
	const config = readJson(exceptionsFile);
	const { report } = runNpmAudit(cwd);
	const evaluation = evaluateAudit(report, config, now);

	console.log('Dependency audit report');
	if (evaluation.findings.length === 0) {
		console.log('- Nenhuma vulnerabilidade reportada.');
	} else {
		for (const finding of evaluation.findings)
			console.log(formatFinding(finding));
	}

	for (const error of evaluation.configurationErrors)
		console.error(`ERROR: ${error}`);
	for (const exception of evaluation.expiredExceptions) {
		console.error(
			`ERROR: exceção expirada ${exception.advisory} (${exception.expires})`
		);
	}
	for (const finding of evaluation.blockingFindings) {
		console.error(
			`ERROR: vulnerabilidade alta/crítica sem exceção: ${finding.name}`
		);
	}

	if (
		evaluation.configurationErrors.length > 0 ||
		evaluation.expiredExceptions.length > 0 ||
		evaluation.blockingFindings.length > 0
	) {
		return 1;
	}
	console.log(
		'Dependency audit passed: nenhuma vulnerabilidade alta ou crítica sem exceção.'
	);
	return 0;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		process.exitCode = run({
			exceptionsFile:
				process.argv
					.find((arg) => arg.startsWith('--exceptions-file='))
					?.split('=')[1] ?? DEFAULT_EXCEPTIONS_FILE
		});
	} catch (error) {
		console.error(`ERROR: ${error.message}`);
		process.exitCode = 1;
	}
}
