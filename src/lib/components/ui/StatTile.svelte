<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Icon as IconType } from 'lucide-svelte';

	let {
		label,
		value,
		icon: Icon,
		href,
		tone = 'neutral',
		hint
	}: {
		label: string;
		value: string;
		icon?: typeof IconType;
		href?: string;
		tone?: 'income' | 'expense' | 'neutral';
		hint?: Snippet;
	} = $props();

	const TONES = {
		income: 'text-income',
		expense: 'text-expense',
		neutral: 'text-text'
	};
</script>

{#snippet body()}
	<p class="flex items-center gap-1.5 text-sm font-medium text-text-muted">
		{#if Icon}<Icon class="h-4 w-4" />{/if}
		{label}
	</p>
	<p class="mt-1 text-2xl font-semibold tabular-nums {TONES[tone]}">{value}</p>
	{#if hint}
		<div class="mt-1 text-xs text-text-muted">{@render hint()}</div>
	{/if}
{/snippet}

{#if href}
	<!-- eslint-disable svelte/no-navigation-without-resolve -- callers pass an already resolved href -->
	<a
		{href}
		class="block rounded-lg bg-surface p-4 shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary"
	>
		{@render body()}
	</a>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{:else}
	<div class="rounded-lg bg-surface p-4 shadow">{@render body()}</div>
{/if}
