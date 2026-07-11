import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callLlm } from '$lib/server/llm';
import { supabaseAdmin } from '$lib/server/supabase';
import { loadUserCategoryExclusions } from '$lib/server/categories';
import { buildGabaritoPromptSection, buildUserTaxonomyPromptSection, filterCategoriesForUser } from '$lib/server/gabarito';
import { buildPersonalGabaritoPromptSection } from '$lib/server/learning';
import { applyRules, loadActiveRules } from './rules';
import { classifyTransactions } from './index';

vi.mock('$lib/server/supabase', () => ({ supabaseAdmin: { rpc: vi.fn() } }));
vi.mock('$lib/server/categories', () => ({ loadUserCategoryExclusions: vi.fn() }));
vi.mock('$lib/server/gabarito', () => ({
	buildGabaritoPromptSection: vi.fn(),
	buildUserTaxonomyPromptSection: vi.fn(),
	filterCategoriesForUser: vi.fn()
}));
vi.mock('$lib/server/learning', () => ({ buildPersonalGabaritoPromptSection: vi.fn() }));
vi.mock('./rules', () => ({ applyRules: vi.fn(), loadActiveRules: vi.fn() }));
vi.mock('$lib/server/llm', () => ({ callLlm: vi.fn() }));

type QueryResult = { data?: unknown; error?: { message: string } | null };

class QueryMock {
	calls: Array<{ method: string; args: unknown[] }> = [];

	constructor(private readonly result: QueryResult) {}

	select(...args: unknown[]) {
		this.calls.push({ method: 'select', args });
		return this;
	}

	in(...args: unknown[]) {
		this.calls.push({ method: 'in', args });
		return this;
	}

	eq(...args: unknown[]) {
		this.calls.push({ method: 'eq', args });
		return this;
	}

	order(...args: unknown[]) {
		this.calls.push({ method: 'order', args });
		return this;
	}

	then(resolve: (value: QueryResult) => unknown) {
		return Promise.resolve(resolve(this.result));
	}
}

function supabaseForQueries(queries: QueryMock[]) {
	return {
		from: () => {
			const query = queries.shift();
			if (!query) throw new Error('Unexpected query');
			return query;
		}
	} as never;
}

const mockedRpc = vi.mocked(supabaseAdmin.rpc);
const mockedCallLlm = vi.mocked(callLlm);
const mockedApplyRules = vi.mocked(applyRules);
const mockedLoadActiveRules = vi.mocked(loadActiveRules);
const mockedLoadExclusions = vi.mocked(loadUserCategoryExclusions);

beforeEach(() => {
	mockedRpc.mockReset();
	mockedCallLlm.mockReset();
	mockedApplyRules.mockReset();
	mockedLoadActiveRules.mockReset();
	mockedLoadExclusions.mockReset();
	vi.mocked(buildGabaritoPromptSection).mockReset();
	vi.mocked(buildUserTaxonomyPromptSection).mockReset();
	vi.mocked(filterCategoriesForUser).mockReset();
	vi.mocked(buildPersonalGabaritoPromptSection).mockReset();
	mockedLoadActiveRules.mockResolvedValue([] as never);
	mockedLoadExclusions.mockResolvedValue(new Set());
	mockedRpc.mockResolvedValue({ data: 1, error: null } as never);
	vi.mocked(buildGabaritoPromptSection).mockReturnValue('');
	vi.mocked(buildUserTaxonomyPromptSection).mockReturnValue('');
	vi.mocked(buildPersonalGabaritoPromptSection).mockResolvedValue('');
});

describe('classifyTransactions', () => {
	it('does not query or update when no transaction was selected', async () => {
		await expect(classifyTransactions(supabaseForQueries([]), 'household-a', [], 'user-a')).resolves.toEqual([]);
		expect(mockedRpc).not.toHaveBeenCalled();
	});

	it('ignores card statement payments instead of classifying them as income', async () => {
		const transactions = new QueryMock({
			data: [
				{
					id: 'tx-a',
					description: 'Pagamento da fatura do cartão',
					clean_description: null,
					merchant: null,
					amount: 250,
					date: '2026-05-10',
					household_id: 'household-a'
				}
			],
			error: null
		});
		const categories = new QueryMock({ data: [], error: null });

		await expect(
			classifyTransactions(supabaseForQueries([transactions, categories]), 'household-a', ['tx-a'], 'user-a')
		).resolves.toEqual([{ id: 'tx-a', method: 'system', needs_review: false }]);

		expect(transactions.calls).toContainEqual({ method: 'eq', args: ['household_id', 'household-a'] });
		expect(mockedApplyRules).not.toHaveBeenCalled();
		expect(mockedRpc).toHaveBeenCalledWith('apply_transaction_classification_updates', {
			updates: [
				{
					id: 'tx-a',
					household_id: 'household-a',
					category_id: null,
					subcategory_id: null,
					owner_profile_id: null,
					classification_method: 'system',
					classification_confidence: 1,
					review_status: 'ignored',
					classification_suggestion: {
						type: 'ignored',
						ignored_reason: 'card_statement_payment',
						reason_code: 'card_statement_payment'
					}
				}
			]
		});
	});

	it('keeps low-confidence rule matches under review', async () => {
		mockedLoadActiveRules.mockResolvedValue([{}] as never);
		mockedApplyRules.mockReturnValue({
			category_id: 'category-a',
			subcategory_id: 'subcategory-a',
			owner_profile_id: null,
			confidence: 0.65,
			reason_code: 'rule_description_contains'
		});
		const transactions = new QueryMock({
			data: [
				{
					id: 'tx-a',
					description: 'Mercado Central',
					clean_description: null,
					merchant: 'Mercado Central',
					amount: -50,
					date: '2026-05-10',
					household_id: 'household-a'
				}
			],
			error: null
		});

		await expect(
			classifyTransactions(
				supabaseForQueries([transactions, new QueryMock({ data: [], error: null })]),
				'household-a',
				['tx-a'],
				'user-a'
			)
		).resolves.toEqual([{ id: 'tx-a', method: 'rule', needs_review: true }]);

		expect(mockedRpc).toHaveBeenCalledWith(
			'apply_transaction_classification_updates',
			expect.objectContaining({
				updates: [
					expect.objectContaining({
						category_id: 'category-a',
						subcategory_id: 'subcategory-a',
						review_status: 'needs_review',
						classification_method: 'rule'
					})
				]
			})
		);
	});

	it('fails instead of silently accepting a partial batch update', async () => {
		mockedLoadActiveRules.mockResolvedValue([{}] as never);
		mockedApplyRules.mockReturnValue({
			category_id: 'category-a',
			subcategory_id: null,
			owner_profile_id: null,
			confidence: 0.9,
			reason_code: 'rule_merchant_contains'
		});
		mockedRpc.mockResolvedValue({ data: 0, error: null } as never);

		const transactions = new QueryMock({
			data: [
				{
					id: 'tx-a',
					description: 'Mercado Central',
					clean_description: null,
					merchant: 'Mercado Central',
					amount: -50,
					date: '2026-05-10',
					household_id: 'household-a'
				}
			],
			error: null
		});

		await expect(
			classifyTransactions(
				supabaseForQueries([transactions, new QueryMock({ data: [], error: null })]),
				'household-a',
				['tx-a'],
				'user-a'
			)
		).rejects.toThrow('Batch classification update mismatch: 0/1');
	});

	it('maps a valid AI suggestion to the allowed category ids', async () => {
		mockedApplyRules.mockReturnValue(null);
		vi.mocked(filterCategoriesForUser).mockImplementation((categories) => categories);
		mockedCallLlm.mockResolvedValue({
			choices: [
				{
					message: {
						content:
							'{"results":[{"id":"tx-a","category":"Alimentação","subcategory":"Mercado","confidence":0.9,"needs_review":false,"reason_code":"merchant_match"}]}'
					}
				}
			]
		} as never);

		const transactions = new QueryMock({
			data: [
				{
					id: 'tx-a',
					description: 'Compra no mercado',
					clean_description: null,
					merchant: null,
					amount: -50,
					date: '2026-05-10',
					household_id: 'household-a'
				}
			],
			error: null
		});
		const categories = new QueryMock({
			data: [
				{ id: 'category-a', name: 'Alimentação', parent_id: null },
				{ id: 'subcategory-a', name: 'Mercado', parent_id: 'category-a' }
			],
			error: null
		});

		await expect(
			classifyTransactions(supabaseForQueries([transactions, categories]), 'household-a', ['tx-a'], 'user-a')
		).resolves.toEqual([{ id: 'tx-a', method: 'llm', needs_review: false }]);

		expect(mockedRpc).toHaveBeenCalledWith(
			'apply_transaction_classification_updates',
			expect.objectContaining({
				updates: [
					expect.objectContaining({
						category_id: 'category-a',
						subcategory_id: 'subcategory-a',
						review_status: 'confirmed',
						classification_method: 'llm'
					})
				]
			})
		);
	});

	it('keeps unknown AI categories under review instead of persisting their text', async () => {
		mockedApplyRules.mockReturnValue(null);
		vi.mocked(filterCategoriesForUser).mockImplementation((categories) => categories);
		mockedCallLlm.mockResolvedValue({
			choices: [
				{
					message: {
						content:
							'{"results":[{"id":"tx-a","category":"Categoria inventada","subcategory":null,"confidence":0.95,"needs_review":false}]}'
					}
				}
			]
		} as never);
		const transactions = new QueryMock({
			data: [
				{
					id: 'tx-a',
					description: 'Compra desconhecida',
					clean_description: null,
					merchant: null,
					amount: -50,
					date: '2026-05-10',
					household_id: 'household-a'
				}
			],
			error: null
		});

		await expect(
			classifyTransactions(
				supabaseForQueries([transactions, new QueryMock({ data: [], error: null })]),
				'household-a',
				['tx-a'],
				'user-a'
			)
		).resolves.toEqual([{ id: 'tx-a', method: 'llm', needs_review: true }]);

		expect(mockedRpc).toHaveBeenCalledWith(
			'apply_transaction_classification_updates',
			expect.objectContaining({
				updates: [expect.objectContaining({ category_id: null, review_status: 'needs_review' })]
			})
		);
	});

	it('marks transactions missing from the AI response for review', async () => {
		mockedApplyRules.mockReturnValue(null);
		vi.mocked(filterCategoriesForUser).mockImplementation((categories) => categories);
		mockedCallLlm.mockResolvedValue({ choices: [{ message: { content: '{"results":[]}' } }] } as never);
		const transactions = new QueryMock({
			data: [
				{
					id: 'tx-a',
					description: 'Compra desconhecida',
					clean_description: null,
					merchant: null,
					amount: -50,
					date: '2026-05-10',
					household_id: 'household-a'
				}
			],
			error: null
		});

		await expect(
			classifyTransactions(
				supabaseForQueries([transactions, new QueryMock({ data: [], error: null })]),
				'household-a',
				['tx-a'],
				'user-a'
			)
		).resolves.toEqual([{ id: 'tx-a', method: 'llm', needs_review: true }]);

		expect(mockedRpc).toHaveBeenCalledWith(
			'apply_transaction_classification_updates',
			expect.objectContaining({
				updates: [
					expect.objectContaining({
						review_status: 'needs_review',
						classification_suggestion: { type: 'error', error: 'missing_in_response' }
					})
				]
			})
		);
	});

	it('treats invalid JSON as a missing response that requires review', async () => {
		mockedApplyRules.mockReturnValue(null);
		vi.mocked(filterCategoriesForUser).mockImplementation((categories) => categories);
		mockedCallLlm.mockResolvedValue({ choices: [{ message: { content: 'not-json' } }] } as never);
		const transactions = new QueryMock({
			data: [
				{
					id: 'tx-a', description: 'Compra desconhecida', clean_description: null,
					merchant: null, amount: -50, date: '2026-05-10', household_id: 'household-a'
				}
			],
			error: null
		});

		await classifyTransactions(
			supabaseForQueries([transactions, new QueryMock({ data: [], error: null })]),
			'household-a', ['tx-a'], 'user-a'
		);

		expect(mockedRpc).toHaveBeenCalledWith(
			'apply_transaction_classification_updates',
			expect.objectContaining({
				updates: [expect.objectContaining({
					review_status: 'needs_review',
					classification_suggestion: { type: 'error', error: 'missing_in_response' }
				})]
			})
		);
	});

	it('turns provider failures into reviewable errors instead of aborting the batch', async () => {
		mockedApplyRules.mockReturnValue(null);
		vi.mocked(filterCategoriesForUser).mockImplementation((categories) => categories);
		mockedCallLlm.mockRejectedValue(new Error('provider unavailable'));
		const transactions = new QueryMock({
			data: [
				{
					id: 'tx-a', description: 'Compra desconhecida', clean_description: null,
					merchant: null, amount: -50, date: '2026-05-10', household_id: 'household-a'
				}
			],
			error: null
		});

		await expect(classifyTransactions(
			supabaseForQueries([transactions, new QueryMock({ data: [], error: null })]),
			'household-a', ['tx-a'], 'user-a'
		)).resolves.toEqual([{ id: 'tx-a', method: 'llm', needs_review: true }]);

		expect(mockedRpc).toHaveBeenCalledWith(
			'apply_transaction_classification_updates',
			expect.objectContaining({
				updates: [expect.objectContaining({
					classification_suggestion: expect.objectContaining({ type: 'error', error: 'llm_error' })
				})]
			})
		);
	});

	it('ignores unknown and duplicate ids returned by the provider', async () => {
		mockedApplyRules.mockReturnValue(null);
		vi.mocked(filterCategoriesForUser).mockImplementation((categories) => categories);
		mockedCallLlm.mockResolvedValue({
			choices: [{ message: { content: JSON.stringify({ results: [
				{ id: 'tx-foreign', category: null, subcategory: null, confidence: 0.9, needs_review: false },
				{ id: 'tx-a', category: null, subcategory: null, confidence: 0.5, needs_review: true },
				{ id: 'tx-a', category: null, subcategory: null, confidence: 0.9, needs_review: false }
			] }) } }]
		} as never);
		const transactions = new QueryMock({ data: [{
			id: 'tx-a', description: 'Compra', clean_description: null, merchant: null,
			amount: -50, date: '2026-05-10', household_id: 'household-a'
		}], error: null });

		await classifyTransactions(
			supabaseForQueries([transactions, new QueryMock({ data: [], error: null })]),
			'household-a', ['tx-a'], 'user-a'
		);

		const rpcPayload = mockedRpc.mock.calls[0]?.[1] as { updates: Array<{ id: string }> };
		expect(rpcPayload.updates).toHaveLength(1);
		expect(rpcPayload.updates[0].id).toBe('tx-a');
	});

	it('splits more than 30 uncategorized transactions into multiple provider batches', async () => {
		mockedApplyRules.mockReturnValue(null);
		mockedRpc.mockResolvedValue({ data: 31, error: null } as never);
		vi.mocked(filterCategoriesForUser).mockImplementation((categories) => categories);
		mockedCallLlm.mockResolvedValue({ choices: [{ message: { content: '{"results":[]}' } }] } as never);
		const rows = Array.from({ length: 31 }, (_, index) => ({
			id: `tx-${index}`, description: `Compra ${index}`, clean_description: null, merchant: null,
			amount: -index - 1, date: '2026-05-10', household_id: 'household-a'
		}));

		const result = await classifyTransactions(
			supabaseForQueries([
				new QueryMock({ data: rows, error: null }),
				new QueryMock({ data: [], error: null })
			]),
			'household-a', rows.map((row) => row.id), 'user-a'
		);

		expect(mockedCallLlm).toHaveBeenCalledTimes(2);
		expect(result).toHaveLength(31);
		expect((mockedRpc.mock.calls[0]?.[1] as { updates: unknown[] }).updates).toHaveLength(31);
	});
});
