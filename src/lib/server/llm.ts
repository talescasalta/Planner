import { env } from '$env/dynamic/private';

const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
const OPENAI_API_KEY = env.OPENAI_API_KEY;
const LLM_MODEL = env.LLM_MODEL;
const API_KEY = OPENROUTER_API_KEY || OPENAI_API_KEY;
const API_URL = OPENROUTER_API_KEY
	? 'https://openrouter.ai/api/v1/chat/completions'
	: 'https://api.openai.com/v1/chat/completions';

const DEFAULT_MODEL =
	LLM_MODEL?.trim() || (OPENROUTER_API_KEY ? 'openai/gpt-4o-mini' : 'gpt-4o-mini');

export interface LlmPayload {
	model?: string;
	messages: Array<{ role: 'system' | 'user'; content: string }>;
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

export async function callLlm(payload: LlmPayload): Promise<LlmResponse> {
	if (!API_KEY) {
		throw new Error('LLM API key not configured');
	}

	const res = await fetch(API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${API_KEY}`,
			...(OPENROUTER_API_KEY ? { 'HTTP-Referer': 'https://localhost', 'X-Title': 'Expense Classifier' } : {})
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
		const text = await res.text();
		throw new Error(`LLM request failed: ${res.status} ${text}`);
	}

	return res.json() as Promise<LlmResponse>;
}
