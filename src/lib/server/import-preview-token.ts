import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { CsvSourceType, ParsedRow } from '$lib/server/csv-parser';

// The preview already paid for the extraction (an LLM call for PDFs and
// screenshots). Handing the rows back as a signed token lets the confirm step
// write exactly what the user reviewed instead of extracting a second time,
// which would double the cost and could return different rows.

export interface PreviewPayload {
	v: 1;
	householdId: string;
	userId: string;
	sourceType: CsvSourceType;
	sourceName: string;
	rows: ParsedRow[];
	exp: number;
}

const TOKEN_TTL_MS = 30 * 60_000;
// SvelteKit's default body limit is 512 KB and the token travels back in the
// confirm form; past this the caller falls back to extracting again.
const MAX_TOKEN_CHARS = 400_000;

function signingKey(): Buffer | null {
	const secret = env.SUPABASE_SECRET_KEY?.trim();
	if (!secret) return null;
	return createHmac('sha256', secret).update('import-preview-v1').digest();
}

function sign(body: string, key: Buffer): string {
	return createHmac('sha256', key).update(body).digest('base64url');
}

export function signPreview(
	payload: Omit<PreviewPayload, 'v' | 'exp'>,
	now = Date.now()
): string | null {
	const key = signingKey();
	if (!key) return null;
	const body = Buffer.from(
		JSON.stringify({ ...payload, v: 1, exp: now + TOKEN_TTL_MS })
	).toString('base64url');
	const token = `${body}.${sign(body, key)}`;
	return token.length > MAX_TOKEN_CHARS ? null : token;
}

export function verifyPreview(
	token: string,
	now = Date.now()
): PreviewPayload | null {
	const key = signingKey();
	const separator = token.lastIndexOf('.');
	if (!key || separator <= 0) return null;
	const body = token.slice(0, separator);
	const signature = Buffer.from(token.slice(separator + 1));
	const expected = Buffer.from(sign(body, key));
	if (
		signature.length !== expected.length ||
		!timingSafeEqual(signature, expected)
	) {
		return null;
	}
	try {
		const payload = JSON.parse(
			Buffer.from(body, 'base64url').toString('utf8')
		) as PreviewPayload;
		if (payload.v !== 1 || payload.exp <= now || !Array.isArray(payload.rows)) {
			return null;
		}
		return payload;
	} catch {
		return null;
	}
}
