import { describe, expect, it, vi } from 'vitest';
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import { ConfirmSubmit } from './confirm-submit.svelte';
import { SubmitState } from './submit-state.svelte';

type Input = Parameters<SubmitFunction>[0];
type Callback = Exclude<Awaited<ReturnType<SubmitFunction>>, void>;

function input(form = {} as HTMLFormElement) {
	const cancel = vi.fn();
	const value = {
		action: new URL('http://localhost/?/save'),
		formData: new FormData(),
		formElement: form,
		controller: new AbortController(),
		submitter: null,
		cancel
	} satisfies Input;
	return { value, cancel };
}

function result() {
	const update = vi.fn(async () => {});
	return {
		update,
		value: {
			action: new URL('http://localhost/?/save'),
			formData: new FormData(),
			formElement: {} as HTMLFormElement,
			result: { type: 'success', status: 200 } as ActionResult,
			update
		}
	};
}

describe('SubmitState', () => {
	it('marks the form pending until the response is applied', async () => {
		const state = new SubmitState();
		const callback = (await state.enhance()(input().value)) as Callback;

		expect(state.pending).toBe(true);
		expect(state.isPending()).toBe(true);

		const res = result();
		await callback(res.value);
		expect(res.update).toHaveBeenCalledOnce();
		expect(state.pending).toBe(false);
	});

	it('cancels a second submit while the first is waiting', async () => {
		const state = new SubmitState();
		const enhance = state.enhance();
		await enhance(input().value);

		const second = input();
		expect(await enhance(second.value)).toBeUndefined();
		expect(second.cancel).toHaveBeenCalledOnce();
	});

	it('tracks keys independently', async () => {
		const state = new SubmitState();
		const callback = (await state.enhance({ key: 'a' })(
			input().value
		)) as Callback;

		expect(state.isPending('a')).toBe(true);
		expect(state.isPending('b')).toBe(false);

		const other = input();
		await state.enhance({ key: 'b' })(other.value);
		expect(other.cancel).not.toHaveBeenCalled();
		expect(state.isPending('b')).toBe(true);

		await callback(result().value);
		expect(state.isPending('a')).toBe(false);
		expect(state.pending).toBe(true);
	});

	it('runs the custom callback instead of the default update', async () => {
		const state = new SubmitState();
		const custom = vi.fn(async () => {});
		const callback = (await state.enhance(() => custom)(
			input().value
		)) as Callback;

		const res = result();
		await callback(res.value);
		expect(custom).toHaveBeenCalledOnce();
		expect(res.update).not.toHaveBeenCalled();
	});

	it('clears the pending flag even when the callback throws', async () => {
		const state = new SubmitState();
		const callback = (await state.enhance(() => async () => {
			throw new Error('boom');
		})(input().value)) as Callback;

		await expect(callback(result().value)).rejects.toThrow('boom');
		expect(state.pending).toBe(false);
	});

	it('stays idle when ConfirmSubmit holds the submit back', async () => {
		const state = new SubmitState();
		const confirmer = new ConfirmSubmit();
		const prompt = { title: 'Excluir?', message: 'Não dá para desfazer.' };
		const form = { requestSubmit: vi.fn() } as unknown as HTMLFormElement;
		const enhance = state.enhance(({ cancel, formElement }) =>
			confirmer.guard(cancel, formElement, prompt)
		);

		const first = input(form);
		expect(await enhance(first.value)).toBeUndefined();
		expect(first.cancel).toHaveBeenCalledOnce();
		expect(state.pending).toBe(false);
		expect(confirmer.pending).toEqual(prompt);

		confirmer.confirm();
		expect(form.requestSubmit).toHaveBeenCalledOnce();

		const confirmed = input(form);
		expect(await enhance(confirmed.value)).toBeTypeOf('function');
		expect(confirmed.cancel).not.toHaveBeenCalled();
		expect(state.pending).toBe(true);
	});
});
