import { timingSafeEqual } from 'node:crypto';

// Small, dependency-free guards shared by every action that accepts a file,
// a free-text field or a secret from the outside. Kept together so a new
// endpoint has one place to copy from — and so the limits stay consistent.

// Vercel already rejects bodies above ~4.5 MB; this cap exists so an oversized
// upload is refused with a readable message instead of a platform error, and
// so a zip-bomb xlsx or a huge PDF never reaches the parsers or the LLM.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function uploadTooLarge(file: { size: number }): boolean {
	return file.size > MAX_UPLOAD_BYTES;
}

export const UPLOAD_TOO_LARGE_MESSAGE = `Arquivo maior que ${
	MAX_UPLOAD_BYTES / (1024 * 1024)
} MB. Envie um arquivo menor.`;

// Every action that triggers an LLM call shares this budget per user (the
// same bucket /api/classify uses), so a leaked session or a script cannot run
// up the provider bill.
export const LLM_RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 } as const;

export const LLM_RATE_LIMIT_MESSAGE =
	'Muitas solicitações em pouco tempo. Aguarde um minuto e tente de novo.';

// Free text bound for anything forwarded into a prompt.
export const MAX_PROMPT_TEXT_CHARS = 20_000;
export const MAX_QUESTION_CHARS = 2_000;

export function clampText(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}

// A rate as a person types it: "96", "96,5", "91.5", optionally with the
// percent sign. Matched whole rather than stripped character by character —
// stripping accepts whatever is left over, and what is left over is not a
// number the caller should have to reason about.
const RATE = /^(\d{1,4}(?:[.,]\d{1,4})?)\s*%?$/;

export function parseRate(value: string | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	const match = RATE.exec(value.trim());
	if (!match) return null;
	const parsed = Number(match[1].replace(',', '.'));
	return Number.isFinite(parsed) ? parsed : null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A date that both looks like YYYY-MM-DD and exists on the calendar, so
// "2026-02-31" is refused before it reaches Postgres or `new Date`.
export function isIsoDate(value: string): boolean {
	const match = ISO_DATE.exec(value);
	if (!match) return false;
	const [, year, month, day] = match.map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

export function isIsoMonth(value: string): boolean {
	const match = /^(\d{4})-(\d{2})$/.exec(value);
	if (!match) return false;
	const month = Number(match[2]);
	return month >= 1 && month <= 12;
}

// Constant-time comparison for bearer secrets: a plain `!==` returns as soon
// as the first byte differs, which leaks how much of a guess was right.
export function secretMatches(
	provided: string | null | undefined,
	expected: string
): boolean {
	if (!provided || expected.length === 0) return false;
	const a = Buffer.from(provided, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

// Reads a bearer token from an Authorization header and checks it.
export function bearerMatches(
	authorization: string | null,
	expected: string
): boolean {
	if (!authorization?.startsWith('Bearer ')) return false;
	return secretMatches(authorization.slice('Bearer '.length), expected);
}
