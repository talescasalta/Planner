// Puts a ConfirmDialog in front of a form submission: the first submit is
// held back and the dialog opens; confirming re-submits the same form once.

type Prompt = { title: string; message: string };

export class ConfirmSubmit {
	pending = $state<Prompt | null>(null);
	private form: HTMLFormElement | null = null;
	private confirmed = false;

	ask(event: SubmitEvent, prompt: Prompt) {
		if (this.confirmed) {
			this.confirmed = false;
			return;
		}
		event.preventDefault();
		this.form = event.currentTarget as HTMLFormElement;
		this.pending = prompt;
	}

	// For forms wired with use:enhance, whose own submit listener would send
	// the request anyway: cancel it from inside the enhance callback.
	guard(cancel: () => void, form: HTMLFormElement, prompt: Prompt) {
		if (this.confirmed) {
			this.confirmed = false;
			return;
		}
		cancel();
		this.form = form;
		this.pending = prompt;
	}

	confirm() {
		const form = this.form;
		this.pending = null;
		this.form = null;
		if (!form) return;
		this.confirmed = true;
		form.requestSubmit();
	}

	cancel() {
		this.pending = null;
		this.form = null;
	}
}
