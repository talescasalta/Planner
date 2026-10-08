// App-wide toast queue. Components call toast.success(...) and the single
// <Toaster /> mounted in the app layout renders them.

type ToastKind = 'success' | 'error' | 'info';

type ToastAction = { label: string; onClick: () => void };

type ToastItem = {
	id: number;
	kind: ToastKind;
	message: string;
	action?: ToastAction;
};

const TOAST_DURATION_MS = 4000;

let nextId = 1;

class ToastStore {
	items = $state<ToastItem[]>([]);

	private push(kind: ToastKind, message: string, action?: ToastAction) {
		const id = nextId++;
		this.items.push({ id, kind, message, action });
		setTimeout(() => this.dismiss(id), TOAST_DURATION_MS);
		return id;
	}

	success(message: string) {
		return this.push('success', message);
	}

	error(message: string) {
		return this.push('error', message);
	}

	info(message: string, options: { action?: ToastAction } = {}) {
		return this.push('info', message, options.action);
	}

	dismiss(id: number) {
		this.items = this.items.filter((item) => item.id !== id);
	}
}

export const toast = new ToastStore();
