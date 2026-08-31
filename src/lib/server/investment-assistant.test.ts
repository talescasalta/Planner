import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/llm', () => ({ callLlm: vi.fn() }));

import {
	parseReply,
	renderContext,
	type PortfolioContext
} from './investment-assistant';
import type { FundCandidate } from './investment-registry';

const candidates: FundCandidate[] = [
	{
		cnpj: '29762315000158',
		subclassId: '30SMU1746554429',
		name: 'SUBCLASSE I DO KINEA ATLAS II',
		previdenciario: false,
		situation: 'Em Funcionamento Normal'
	},
	{
		cnpj: '47033019000106',
		subclassId: '',
		name: 'TREND B50 PREV XP SEGUROS',
		previdenciario: true,
		situation: 'Em Funcionamento Normal'
	}
];

const reply = (payload: Record<string, unknown>) => JSON.stringify(payload);

describe('parseReply', () => {
	it('takes a proposal only through a candidate index', () => {
		const result = parseReply(
			reply({
				reply: 'Achei o fundo.',
				proposal: {
					candidate_index: 0,
					name: 'Kinea Atlas II',
					balance: 18302.57,
					applied: 9140.34,
					balance_date: '2026-08-31'
				}
			}),
			candidates
		);
		expect(result.proposal).toMatchObject({
			cnpj: '29762315000158',
			subclassId: '30SMU1746554429',
			balance: 18302.57,
			applied: 9140.34
		});
	});

	it('drops a proposal that names a CNPJ instead of picking one', () => {
		// The dangerous case: a fabricated CNPJ values today correctly and only
		// diverges later, following another fund's series.
		const result = parseReply(
			reply({
				reply: 'Cadastrei.',
				proposal: {
					cnpj: '11111111000191',
					name: 'Fundo Inventado',
					balance: 1000
				}
			}),
			candidates
		);
		expect(result.proposal).toBeNull();
		expect(result.reply).toBe('Cadastrei.');
	});

	it('drops a proposal pointing outside the candidate list', () => {
		const out = parseReply(
			reply({
				reply: 'ok',
				proposal: { candidate_index: 7, name: 'X', balance: 100 }
			}),
			candidates
		);
		expect(out.proposal).toBeNull();
		const negative = parseReply(
			reply({
				reply: 'ok',
				proposal: { candidate_index: -1, name: 'X', balance: 100 }
			}),
			candidates
		);
		expect(negative.proposal).toBeNull();
	});

	it('refuses a proposal without a usable balance', () => {
		for (const balance of [0, -50]) {
			const result = parseReply(
				reply({
					reply: 'ok',
					proposal: { candidate_index: 0, name: 'X', balance }
				}),
				candidates
			);
			expect(result.proposal).toBeNull();
		}
	});

	it('marks a previdenciário candidate as previdência even if the model says otherwise', () => {
		const result = parseReply(
			reply({
				reply: 'ok',
				proposal: {
					candidate_index: 1,
					name: 'Trend B50',
					balance: 229528.12,
					kind: 'fundo'
				}
			}),
			candidates
		);
		expect(result.proposal?.kind).toBe('previdencia');
	});

	it('passes a search term through so the caller can look it up', () => {
		const result = parseReply(
			reply({ reply: 'Vou procurar.', search: '  Nu Reserva Imediata ' }),
			[]
		);
		expect(result.search).toBe('Nu Reserva Imediata');
		expect(result.proposal).toBeNull();
	});

	it('survives a non-JSON or malformed answer', () => {
		expect(parseReply('desculpe, não sei', candidates).proposal).toBeNull();
		expect(parseReply(reply({ nope: 1 }), candidates).reply).toMatch(/formato/);
	});
});

describe('renderContext', () => {
	const context: PortfolioContext = {
		today: '2026-08-31',
		totalValue: 1475603.83,
		lastReconciliation: '2026-08-27',
		positions: [
			{
				label: 'BOVA11',
				assetClass: 'etf',
				quantity: 170,
				value: 29209.4,
				averageCost: null,
				monthGain: 500,
				monthReturn: 0.017
			}
		],
		months: [
			{
				month: '2026-08',
				gain: 22018.29,
				returnRate: 0.0201,
				cdiRate: 0.0094,
				percentOfCdi: 214,
				unpricedCount: 1
			}
		],
		pendingDarf: [{ month: '2026-07', amount: 120.5, dueDate: '2026-08-31' }]
	};

	it('states the data the model may use, and nothing else', () => {
		const rendered = renderContext(context);
		expect(rendered).toContain('BOVA11');
		expect(rendered).toContain('214% do CDI');
		expect(rendered).toContain('1 ativo(s) sem preço no período');
		expect(rendered).toContain('DARF em aberto');
	});

	it('says plainly when there is no official position yet', () => {
		const rendered = renderContext({
			...context,
			lastReconciliation: null,
			positions: [],
			months: [],
			pendingDarf: []
		});
		expect(rendered).toContain('Nenhuma posição oficial importada');
		expect(rendered).not.toContain('DARF em aberto');
	});
});
