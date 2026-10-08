// Focus helpers shared by the modal components (Sheet, ConfirmDialog).

export const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Svelte action: keeps Tab inside `node` and puts focus back on whatever had
// it before the dialog opened once the node goes away.
export function trapFocus(node: HTMLElement) {
	const previous = document.activeElement as HTMLElement | null;

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (items.length === 0) {
			event.preventDefault();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	node.addEventListener('keydown', onKeydown);
	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			previous?.focus?.();
		}
	};
}
