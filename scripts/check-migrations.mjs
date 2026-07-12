import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_MIGRATIONS_DIR = resolve(ROOT, 'supabase/migrations');

const FUNCTION_DECLARATION =
	/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:[A-Za-z_][\w$]*\.)?[A-Za-z_][\w$]*)\s*\(/gi;
const TABLE_DECLARATION =
	/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(public\.[A-Za-z_][\w$]*)\b/gi;

function stripSqlComments(sql) {
	return sql
		.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, ' '))
		.replace(/--[^\r\n]*/g, (comment) => comment.replace(/[^\r\n]/g, ' '));
}

function lineNumber(sql, offset) {
	return sql.slice(0, offset).split(/\r?\n/).length;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasMatchAfter(sql, pattern, offset = 0) {
	const match = pattern.exec(sql.slice(offset));
	return Boolean(match);
}

function functionBlocks(sql) {
	const sanitized = stripSqlComments(sql);
	const matches = [...sanitized.matchAll(FUNCTION_DECLARATION)];
	return matches.map((match, index) => {
		const start = match.index ?? 0;
		const end = matches[index + 1]?.index ?? sanitized.length;
		const name = match[1].toLowerCase();
		const schema = name.includes('.') ? name.split('.')[0] : 'public';
		return {
			name,
			schema,
			start,
			line: lineNumber(sql, start),
			text: sanitized.slice(start, end)
		};
	});
}

function tableDeclarations(sql) {
	const sanitized = stripSqlComments(sql);
	return [...sanitized.matchAll(TABLE_DECLARATION)].map((match) => ({
		name: match[1].toLowerCase(),
		start: match.index ?? 0,
		line: lineNumber(sql, match.index ?? 0)
	}));
}

function hasSearchPath(functionBlock) {
	return /\bSET\s+search_path\s*(?:=|TO)\s*/i.test(functionBlock.text);
}

function explicitRevokePattern(functionName, role) {
	const escapedName = escapeRegExp(functionName);
	return new RegExp(
		`\\bREVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escapedName}\\s*\\([^;]*\\)\\s+FROM\\s+${role}\\b`,
		'i'
	);
}

function globalRevokePattern(role) {
	return new RegExp(
		`\\bREVOKE\\s+EXECUTE\\s+ON\\s+ALL\\s+FUNCTIONS\\s+IN\\s+SCHEMA\\s+public\\s+FROM\\s+${role}\\b`,
		'i'
	);
}

function hasPublicFunctionRevoke(files, fileIndex, functionBlock) {
	const roles = [
		{
			name: 'PUBLIC',
			pattern: explicitRevokePattern(functionBlock.name, 'PUBLIC'),
			global: globalRevokePattern('PUBLIC')
		},
		{
			name: 'anon/authenticated',
			pattern: explicitRevokePattern(
				functionBlock.name,
				'anon\\s*,\\s*authenticated'
			),
			global: globalRevokePattern('anon\\s*,\\s*authenticated')
		}
	];

	return roles.every((role) =>
		files.slice(fileIndex).some((file, relativeIndex) => {
			const offset = relativeIndex === 0 ? functionBlock.start : 0;
			return (
				hasMatchAfter(file.sanitized, role.pattern, offset) ||
				hasMatchAfter(file.sanitized, role.global, offset)
			);
		})
	);
}

export function auditMigrationContents(contents) {
	const files = contents
		.map((file) => ({
			name: file.name,
			content: file.content,
			sanitized: stripSqlComments(file.content)
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
	const issues = [];
	const functions = [];
	const tables = [];

	for (const [fileIndex, file] of files.entries()) {
		for (const table of tableDeclarations(file.content)) {
			tables.push({ file: file.name, ...table });
			const tablePattern = new RegExp(
				`\\bALTER\\s+TABLE\\s+${escapeRegExp(table.name)}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY\\b`,
				'i'
			);
			if (!tablePattern.test(file.sanitized)) {
				issues.push({
					file: file.name,
					line: table.line,
					rule: 'public-table-rls',
					message: `${table.name} precisa habilitar RLS no mesmo arquivo da criação.`
				});
			}
		}

		for (const functionBlock of functionBlocks(file.content)) {
			if (!/\bSECURITY\s+DEFINER\b/i.test(functionBlock.text)) continue;
			functions.push({ file: file.name, ...functionBlock });

			if (!hasSearchPath(functionBlock)) {
				issues.push({
					file: file.name,
					line: functionBlock.line,
					rule: 'security-definer-search-path',
					message: `${functionBlock.name} usa SECURITY DEFINER sem SET search_path explícito.`
				});
			}

			if (
				functionBlock.schema === 'public' &&
				!hasPublicFunctionRevoke(files, fileIndex, functionBlock)
			) {
				issues.push({
					file: file.name,
					line: functionBlock.line,
					rule: 'security-definer-revoke',
					message: `${functionBlock.name} usa SECURITY DEFINER sem REVOKE EXECUTE correspondente para PUBLIC, anon e authenticated.`
				});
			}
		}
	}

	return { files, issues, functions, tables };
}

export function readMigrationContents(directory = DEFAULT_MIGRATIONS_DIR) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
		.map((entry) => ({
			name: entry.name,
			content: readFileSync(resolve(directory, entry.name), 'utf8')
		}));
}

export function run({ directory = DEFAULT_MIGRATIONS_DIR } = {}) {
	const result = auditMigrationContents(readMigrationContents(directory));
	console.log(
		`Migration quality report: ${result.files.length} arquivos, ${result.tables.length} tabelas públicas e ${result.functions.length} funções SECURITY DEFINER.`
	);

	if (result.issues.length === 0) {
		console.log('Migration quality passed.');
		return 0;
	}

	for (const issue of result.issues) {
		console.error(
			`ERROR: ${issue.file}:${issue.line} [${issue.rule}] ${issue.message}`
		);
	}
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
