<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle,
		actions,
		class: className = '',
		children
	}: {
		title?: string;
		subtitle?: string;
		actions?: Snippet;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<section class="rounded-lg bg-surface p-4 shadow {className}">
	{#if title || actions}
		<header class="mb-3 flex items-start justify-between gap-3">
			<div class="min-w-0">
				{#if title}
					<h3 class="text-sm font-medium text-text-muted">{title}</h3>
				{/if}
				{#if subtitle}
					<p class="mt-0.5 text-xs text-text-muted">{subtitle}</p>
				{/if}
			</div>
			{#if actions}
				<div class="shrink-0">{@render actions()}</div>
			{/if}
		</header>
	{/if}
	{@render children()}
</section>
