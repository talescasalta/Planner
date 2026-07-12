import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditMigrationContents } from './check-migrations.mjs';

const FIXTURES = resolve('scripts/fixtures/migrations');

function fixture(name) {
	return readFileSync(resolve(FIXTURES, name), 'utf8');
}

test('migrations atuais e fixture segura passam nas regras', async () => {
	const { readMigrationContents } = await import('./check-migrations.mjs');
	const current = auditMigrationContents(readMigrationContents());
	const valid = auditMigrationContents([
		{ name: 'valid.sql', content: fixture('valid.sql') }
	]);

	assert.deepEqual(current.issues, []);
	assert.deepEqual(valid.issues, []);
});

test('detecta tabela pública sem RLS, definer sem search_path e sem REVOKE', () => {
	const result = auditMigrationContents([
		{ name: 'invalid.sql', content: fixture('invalid.sql') }
	]);
	assert.deepEqual(result.issues.map((issue) => issue.rule).sort(), [
		'public-table-rls',
		'security-definer-revoke',
		'security-definer-search-path'
	]);
});
