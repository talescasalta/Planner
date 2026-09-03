import { env } from '$env/dynamic/private';

const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
const OPENAI_API_KEY = env.OPENAI_API_KEY;
const LLM_MODEL = env.LLM_MODEL;
const API_KEY = OPENROUTER_API_KEY || OPENAI_API_KEY;
const API_URL = OPENROUTER_API_KEY
	? 'https://openrouter.ai/api/v1/chat/completions'
	: 'https://api.openai.com/v1/chat/completions';

const DEFAULT_MODEL =
	LLM_MODEL?.trim() ||
	(OPENROUTER_API_KEY ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');

export interface LlmConfigSummary {
	provider: 'openrouter' | 'openai' | null;
	model: string | null;
	/**
	 * False when LLM_MODEL is unset and DEFAULT_MODEL is standing in. Worth
	 * surfacing: the fallback is a much weaker model than the one normally
	 * configured, and nothing else makes that visible from outside.
	 */
	modelExplicitlyConfigured: boolean;
}

// Reports which model the server would actually call. Names only -- the API
// key must never leave the server.
export function llmConfigSummary(): LlmConfigSummary {
	return {
		provider: OPENROUTER_API_KEY
			? 'openrouter'
			: OPENAI_API_KEY
				? 'openai'
				: null,
		model: API_KEY ? DEFAULT_MODEL : null,
		modelExplicitlyConfigured: Boolean(LLM_MODEL?.trim())
	};
}

export type LlmContentPart =
	| { type: 'text'; text: string }
	| { type: 'image_url'; image_url: { url: string } };

export interface LlmPayload {
	model?: string;
	messages: Array<{
		role: 'system' | 'user';
		content: string | LlmContentPart[];
	}>;
	temperature?: number;
	max_tokens?: number;
	json_mode?: boolean;
}

export interface LlmResponse {
	choices: Array<{
		message: {
			content: string;
		};
	}>;
}

// A hung provider must not hold a serverless function open until the
// platform kills it.
const LLM_TIMEOUT_MS = 60_000;

export async function callLlm(payload: LlmPayload): Promise<LlmResponse> {
	if (!API_KEY) {
		throw new Error('LLM API key not configured');
	}

	const res = await fetch(API_URL, {
		method: 'POST',
		signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${API_KEY}`,
			...(OPENROUTER_API_KEY
				? {
						'HTTP-Referer': 'https://localhost',
						'X-Title': 'Expense Classifier'
					}
				: {})
		},
		body: JSON.stringify({
			model: payload.model ?? DEFAULT_MODEL,
			messages: payload.messages,
			temperature: payload.temperature ?? 0.2,
			max_tokens: payload.max_tokens ?? 500,
			...(payload.json_mode ? { response_format: { type: 'json_object' } } : {})
		})
	});

	if (!res.ok) {
		// The provider's body can echo request details; it belongs in the
		// server log, never in a message that reaches the browser.
		console.error('[llm] request failed', res.status, await res.text());
		throw new Error(`LLM request failed: ${res.status}`);
	}

	return res.json() as Promise<LlmResponse>;
}
