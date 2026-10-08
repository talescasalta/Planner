<script lang="ts">
	import { X } from 'lucide-svelte';
	import type { Snippet } from 'svelte';
	import { FOCUSABLE, trapFocus } from '$lib/focus';

	let {
		open,
		title,
		onClose,
		children,
		footer
	}: {
		open: boolean;
		title: string;
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	const titleId = `sheet-title-${Math.random().toString(36).slice(2, 8)}`;
	let panel: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (!open || !panel) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const content = panel.querySelector<HTMLElement>('[data-sheet-body]');
		(content?.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
		return () => {
			document.body.style.overflow = previous;
		};
	});

	function onKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<button
		type="button"
		class="fixed inset-0 z-30 bg-black/40"
		aria-label="Fechar"
		tabindex="-1"
		onclick={onClose}
	></button>

	<div
		bind:this={panel}
		use:trapFocus
		tabindex="-1"
		class="fixed inset-x-0 bottom-0 z-40 flex max-h-[85vh] flex-col rounded-t-2xl bg-surface shadow-xl outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-full sm:max-w-md sm:rounded-none"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
	>
		<div class="flex justify-center pt-2 sm:hidden" aria-hidden="true">
			<span class="h-1 w-10 rounded-full bg-gray-300"></span>
		</div>
		<div
			class="flex items-center justify-between gap-3 border-b border-gray-200 py-1 pr-1 pl-4"
		>
			<h2 id={titleId} class="truncate text-lg font-semibold text-gray-900">
				{title}
			</h2>
			<button
				type="button"
				class="flex h-11 w-11 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700"
				aria-label="Fechar"
				onclick={onClose}
			>
				<X class="h-5 w-5" />
			</button>
		</div>
		<div data-sheet-body class="min-h-0 flex-1 overflow-y-auto p-4">
			{@render children()}
		</div>
		{#if footer}
			<div class="border-t border-gray-200 p-4">
				{@render footer()}
			</div>
		{/if}
		<div class="pb-[env(safe-area-inset-bottom)] sm:hidden"></div>
	</div>
{/if}
