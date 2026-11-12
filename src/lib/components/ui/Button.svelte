<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Spinner from './Spinner.svelte';

	let {
		variant = 'primary',
		size = 'md',
		href,
		type = 'button',
		disabled = false,
		loading = false,
		loadingLabel,
		form,
		name,
		value,
		onclick,
		class: className = '',
		children
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
		size?: 'sm' | 'md';
		href?: string;
		type?: HTMLButtonAttributes['type'];
		disabled?: boolean;
		// While true the button is disabled, marked aria-busy and shows a
		// spinner (plus loadingLabel, when given) in place of its label.
		loading?: boolean;
		loadingLabel?: string;
		form?: string;
		name?: string;
		value?: string;
		onclick?: (event: MouseEvent) => void;
		class?: string;
		children: Snippet;
	} = $props();

	const VARIANTS = {
		primary: 'bg-primary text-white hover:bg-primary-hover',
		secondary: 'border border-border bg-surface text-text hover:bg-canvas',
		ghost: 'text-neutral-flow hover:bg-canvas hover:text-text',
		danger: 'bg-danger text-white hover:bg-red-700',
		success: 'bg-green-600 text-white hover:bg-green-700'
	};
	const SIZES = {
		sm: 'min-h-11 px-3 text-sm md:min-h-8',
		md: 'min-h-11 px-4 text-sm md:min-h-10'
	};

	const classes = $derived(
		`inline-flex items-center justify-center gap-2 rounded font-medium whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${loading ? 'cursor-wait opacity-80' : 'disabled:cursor-not-allowed disabled:opacity-50'} ${VARIANTS[variant]} ${SIZES[size]} ${className}`
	);
</script>

{#if href}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass an already resolved href -->
	<a {href} class={classes} {onclick}>{@render children()}</a>
{:else}
	<button
		{type}
		disabled={disabled || loading}
		aria-busy={loading}
		{form}
		{name}
		{value}
		{onclick}
		class={classes}
	>
		<!-- Both layers share one grid cell, so the button keeps the width of
		     the wider one and the label does not jump when loading toggles. -->
		<span class="grid place-items-center">
			<span
				class={`col-start-1 row-start-1 inline-flex items-center gap-2 ${loading ? 'invisible' : ''}`}
			>
				{@render children()}
			</span>
			<span
				class={`col-start-1 row-start-1 inline-flex items-center gap-2 ${loading ? '' : 'invisible'}`}
				aria-hidden={!loading}
			>
				<Spinner />
				{#if loadingLabel}{loadingLabel}{/if}
			</span>
		</span>
	</button>
{/if}
