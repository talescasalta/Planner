<script lang="ts">
	// Text-only submit button (links in tables, "Excluir" next to a chip).
	// Callers keep their own color and size classes; while loading it is
	// disabled, aria-busy and shows a spinner before loadingLabel.
	import type { Snippet } from 'svelte';
	import Spinner from './Spinner.svelte';

	let {
		loading = false,
		loadingLabel,
		disabled = false,
		form,
		title,
		class: className = '',
		spinnerClass = 'h-3 w-3',
		children
	}: {
		loading?: boolean;
		loadingLabel?: string;
		disabled?: boolean;
		form?: string;
		title?: string;
		class?: string;
		spinnerClass?: string;
		children: Snippet;
	} = $props();
</script>

<button
	type="submit"
	disabled={disabled || loading}
	aria-busy={loading}
	{form}
	{title}
	class={`inline-flex items-center gap-1 disabled:opacity-60 ${loading ? 'cursor-wait' : 'disabled:cursor-not-allowed'} ${className}`}
>
	{#if loading}
		<Spinner class={spinnerClass} />
		{#if loadingLabel}{loadingLabel}{:else}{@render children()}{/if}
	{:else}
		{@render children()}
	{/if}
</button>
