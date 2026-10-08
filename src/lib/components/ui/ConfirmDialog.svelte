<script lang="ts">
	import { trapFocus } from '$lib/focus';
	import Button from './Button.svelte';

	let {
		open,
		title,
		message,
		confirmLabel = 'Confirmar',
		tone = 'danger',
		onConfirm,
		onCancel
	}: {
		open: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		tone?: 'danger' | 'primary';
		onConfirm: () => void;
		onCancel: () => void;
	} = $props();

	const uid = Math.random().toString(36).slice(2, 8);
	const titleId = `confirm-title-${uid}`;
	const messageId = `confirm-message-${uid}`;
	let cancelButton: HTMLButtonElement | undefined = $state();

	// Land on the safe choice, so Enter never confirms a deletion by accident.
	$effect(() => {
		if (open) cancelButton?.focus();
	});

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') onCancel();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			class="absolute inset-0 bg-gray-900/40"
			aria-label="Cancelar"
			tabindex="-1"
			onclick={onCancel}
		></button>
		<div
			use:trapFocus
			role="alertdialog"
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={messageId}
			class="relative w-full max-w-sm rounded-lg bg-surface p-5 shadow-xl"
		>
			<h2 id={titleId} class="text-lg font-semibold text-text">{title}</h2>
			<p id={messageId} class="mt-2 text-sm text-text-muted">{message}</p>
			<div class="mt-5 flex justify-end gap-2">
				<button
					bind:this={cancelButton}
					type="button"
					class="inline-flex min-h-11 items-center rounded border border-border px-4 text-sm font-medium text-text hover:bg-canvas md:min-h-10"
					onclick={onCancel}>Cancelar</button
				>
				<Button variant={tone} onclick={onConfirm}>{confirmLabel}</Button>
			</div>
		</div>
	</div>
{/if}
