<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let {
		variant = 'primary',
		size = 'md',
		href,
		type = 'button',
		disabled = false,
		form,
		onclick,
		class: className = '',
		children
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md';
		href?: string;
		type?: HTMLButtonAttributes['type'];
		disabled?: boolean;
		form?: string;
		onclick?: (event: MouseEvent) => void;
		class?: string;
		children: Snippet;
	} = $props();

	const VARIANTS = {
		primary: 'bg-primary text-white hover:bg-primary-hover',
		secondary: 'border border-border bg-surface text-text hover:bg-canvas',
		ghost: 'text-neutral-flow hover:bg-canvas hover:text-text',
		danger: 'bg-danger text-white hover:bg-red-700'
	};
	const SIZES = {
		sm: 'min-h-11 px-3 text-sm md:min-h-8',
		md: 'min-h-11 px-4 text-sm md:min-h-10'
	};

	const classes = $derived(
		`inline-flex items-center justify-center gap-2 rounded font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`
	);
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass an already resolved href -->
	<a {href} class={classes} {onclick}>{@render children()}</a>
{:else}
	<button {type} {disabled} {form} {onclick} class={classes}>
		{@render children()}
	</button>
{/if}
