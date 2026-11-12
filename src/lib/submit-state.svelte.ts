// Tracks which use:enhance forms are waiting for the server, so their
// buttons can show a spinner and refuse a second submit.
//
//   const submits = new SubmitState();
//   <form use:enhance={submits.enhance()}>
//     <Button type="submit" loading={submits.pending}>Salvar</Button>
//
// For several forms on one page, or one form per list item, give each a key:
//   <form use:enhance={submits.enhance({ key: tx.id })}>
//     <Button loading={submits.isPending(tx.id)}>
//
// A custom SubmitFunction still runs; when it calls cancel() (for example
// through ConfirmSubmit.guard) the form is not marked as pending.

import type { SubmitFunction } from '@sveltejs/kit';

const DEFAULT_KEY = '';

type Options = {
	key?: string;
	submit?: SubmitFunction;
};

type Submit = SubmitFunction;

export class SubmitState {
	#pending = $state<Record<string, true>>({});

	/** True while any form tracked by this instance is waiting. */
	get pending(): boolean {
		return Object.keys(this.#pending).length > 0;
	}

	isPending(key: string = DEFAULT_KEY): boolean {
		return this.#pending[key] === true;
	}

	enhance(options: Options | Submit = {}): Submit {
		const { key = DEFAULT_KEY, submit } =
			typeof options === 'function' ? { submit: options } : options;

		return async (input) => {
			if (this.isPending(key)) {
				input.cancel();
				return;
			}

			let cancelled = false;
			const callback = await submit?.({
				...input,
				cancel: () => {
					cancelled = true;
					input.cancel();
				}
			});
			if (cancelled) return;

			this.#set(key, true);
			return async (result) => {
				try {
					if (callback) await callback(result);
					else await result.update();
				} finally {
					this.#set(key, false);
				}
			};
		};
	}

	#set(key: string, value: boolean) {
		const next = { ...this.#pending };
		if (value) next[key] = true;
		else delete next[key];
		this.#pending = next;
	}
}
