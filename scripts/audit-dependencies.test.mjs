import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit } from './audit-dependencies.mjs';

const FIXTURES = resolve('scripts/fixtures/audit');
const now = new Date('2026-07-11T12:00:00.000Z');

function fixture(name) {
	return JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8'));
}

test('falha para advisory alto não exceptuado', () => {
	const result = evaluateAudit(
		fixture('high-unexcepted.json'),
		{ exceptions: [] },
		now
	);
	assert.equal(result.blockingFindings.length, 1);
	assert.equal(result.blockingFindings[0].name, 'fixture-high');
});

test('aceita exceção válida e mantém o achado visível', () => {
	const result = evaluateAudit(
		fixture('valid-exception.json').audit,
		fixture('valid-exception.json').exceptions,
		now
	);
	assert.equal(result.blockingFindings.length, 0);
	assert.equal(result.findings[0].exception.advisory, 'GHSA-test-high-0000');
});

test('falha para exceção expirada', () => {
	const result = evaluateAudit(
		fixture('expired-exception.json').audit,
		fixture('expired-exception.json').exceptions,
		now
	);
	assert.equal(result.expiredExceptions.length, 1);
});

test('reporta moderadas e baixas sem bloquear', () => {
	const result = evaluateAudit(
		fixture('moderate-low.json'),
		{ exceptions: [] },
		now
	);
	assert.equal(result.blockingFindings.length, 0);
	assert.deepEqual(result.findings.map((finding) => finding.severity).sort(), [
		'low',
		'moderate'
	]);
});

test('não libera o mesmo pacote com advisory diferente ou ausente', () => {
	const data = fixture('advisory-mismatch.json');
	for (const report of [data.differentAdvisory, data.missingAdvisory]) {
		const result = evaluateAudit(report, data.exceptions, now);
		assert.equal(result.blockingFindings.length, 1);
		assert.equal(result.findings[0].exception, undefined);
	}
});
