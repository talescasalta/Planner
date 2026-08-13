import { afterEach, describe, expect, it, vi } from 'vitest';

// llm.ts reads the environment once at module load, so each case has to load a
// fresh copy with the environment it is describing.
async function summaryWithEnv(env: Record<string, string | undefined>) {
	vi.resetModules();
	vi.doMock('$env/dynamic/private', () => ({ env }));
	const { llmConfigSummary } = await import('./llm');
	return llmConfigSummary();
}

afterEach(() => {
	vi.doUnmock('$env/dynamic/private');
	vi.resetModules();
});

describe('llmConfigSummary', () => {
	it('reports the configured model and provider', async () => {
		expect(
			await summaryWithEnv({
				OPENROUTER_API_KEY: 'or-secret',
				LLM_MODEL: 'openai/gpt-5.6-luna'
			})
		).toEqual({
			provider: 'openrouter',
			model: 'openai/gpt-5.6-luna',
			modelExplicitlyConfigured: true
		});
	});

	// The whole point of surfacing this: an unset LLM_MODEL silently downgrades
	// extraction quality, and nothing else makes that visible from outside.
	it('flags when the fallback model is standing in for an unset LLM_MODEL', async () => {
		expect(await summaryWithEnv({ OPENROUTER_API_KEY: 'or-secret' })).toEqual({
			provider: 'openrouter',
			model: 'openai/gpt-4o-mini',
			modelExplicitlyConfigured: false
		});

		expect(
			await summaryWithEnv({ OPENROUTER_API_KEY: 'or-secret', LLM_MODEL: '  ' })
		).toMatchObject({ modelExplicitlyConfigured: false });
	});

	it('falls back to OpenAI when only that key is present', async () => {
		expect(await summaryWithEnv({ OPENAI_API_KEY: 'oa-secret' })).toEqual({
			provider: 'openai',
			model: 'gpt-4o-mini',
			modelExplicitlyConfigured: false
		});
	});

	it('reports nothing configured when no key is present', async () => {
		expect(await summaryWithEnv({ LLM_MODEL: 'openai/gpt-5.6-luna' })).toEqual({
			provider: null,
			model: null,
			modelExplicitlyConfigured: true
		});
	});

	it('never includes the API key', async () => {
		const summary = await summaryWithEnv({
			OPENROUTER_API_KEY: 'or-secret-value',
			OPENAI_API_KEY: 'oa-secret-value',
			LLM_MODEL: 'openai/gpt-5.6-luna'
		});

		expect(JSON.stringify(summary)).not.toContain('secret-value');
	});
});
