import { describe, expect, it } from 'vitest';
import {
	MAX_UPLOAD_BYTES,
	bearerMatches,
	clampText,
	isIsoDate,
	isIsoMonth,
	parseRate,
	secretMatches,
	uploadTooLarge
} from './request-guards';

describe('uploadTooLarge', () => {
	it('accepts files at the limit and refuses one byte over', () => {
		expect(uploadTooLarge({ size: MAX_UPLOAD_BYTES })).toBe(false);
		expect(uploadTooLarge({ size: MAX_UPLOAD_BYTES + 1 })).toBe(true);
		expect(uploadTooLarge({ size: 0 })).toBe(false);
	});
});

describe('clampText', () => {
	it('truncates only when longer than the maximum', () => {
		expect(clampText('abc', 5)).toBe('abc');
		expect(clampText('abcdef', 3)).toBe('abc');
	});
});

describe('isIsoDate', () => {
	it('accepts real calendar dates', () => {
		expect(isIsoDate('2026-08-31')).toBe(true);
		expect(isIsoDate('2024-02-29')).toBe(true);
	});

	it('refuses malformed or impossible dates', () => {
		expect(isIsoDate('2026-02-31')).toBe(false);
		expect(isIsoDate('2026-13-01')).toBe(false);
		expect(isIsoDate('2023-02-29')).toBe(false);
		expect(isIsoDate('31/08/2026')).toBe(false);
		expect(isIsoDate('2026-08-31T00:00:00Z')).toBe(false);
		expect(isIsoDate('')).toBe(false);
	});
});

describe('isIsoMonth', () => {
	it('accepts YYYY-MM within 01..12', () => {
		expect(isIsoMonth('2026-01')).toBe(true);
		expect(isIsoMonth('2026-12')).toBe(true);
	});

	it('refuses other shapes', () => {
		expect(isIsoMonth('2026-00')).toBe(false);
		expect(isIsoMonth('2026-13')).toBe(false);
		expect(isIsoMonth('2026-1')).toBe(false);
		expect(isIsoMonth('2026-08-01')).toBe(false);
	});
});

describe('secretMatches / bearerMatches', () => {
	it('matches only the exact secret', () => {
		expect(secretMatches('abc123', 'abc123')).toBe(true);
		expect(secretMatches('abc124', 'abc123')).toBe(false);
		expect(secretMatches('abc12', 'abc123')).toBe(false);
		expect(secretMatches('abc1234', 'abc123')).toBe(false);
	});

	it('never matches an empty or missing value', () => {
		expect(secretMatches('', '')).toBe(false);
		expect(secretMatches(null, 'abc')).toBe(false);
		expect(secretMatches(undefined, 'abc')).toBe(false);
		expect(secretMatches('abc', '')).toBe(false);
	});

	it('requires the Bearer scheme', () => {
		expect(bearerMatches('Bearer abc123', 'abc123')).toBe(true);
		expect(bearerMatches('bearer abc123', 'abc123')).toBe(false);
		expect(bearerMatches('abc123', 'abc123')).toBe(false);
		expect(bearerMatches(null, 'abc123')).toBe(false);
		expect(bearerMatches('Bearer ', 'abc123')).toBe(false);
	});
});

describe('parseRate', () => {
	it('accepts a rate the way a person types it', () => {
		expect(parseRate('96')).toBe(96);
		expect(parseRate('96,5')).toBe(96.5);
		expect(parseRate('91.5')).toBe(91.5);
		expect(parseRate('96%')).toBe(96);
		expect(parseRate(' 96,5 % ')).toBe(96.5);
	});

	it('refuses anything that is not exactly one number', () => {
		expect(parseRate('96%%')).toBeNull();
		expect(parseRate('96 96')).toBeNull();
		expect(parseRate('9,6,5')).toBeNull();
		expect(parseRate('-96')).toBeNull();
		expect(parseRate('abc')).toBeNull();
		expect(parseRate('')).toBeNull();
		expect(parseRate(null)).toBeNull();
		expect(parseRate(undefined)).toBeNull();
	});
});
