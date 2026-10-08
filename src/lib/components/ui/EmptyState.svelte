<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Icon as IconType } from 'lucide-svelte';

	let {
		title,
		description,
		icon: Icon,
		actions
	}: {
		title: string;
		description?: string;
		icon?: typeof IconType;
		actions?: Snippet;
	} = $props();
</script>

<section class="rounded-lg bg-surface px-6 py-8 text-center shadow">
	{#if Icon}
		<Icon class="mx-auto h-10 w-10 text-gray-300" aria-hidden="true" />
	{/if}
	<h3 class="mt-3 text-base font-semibold text-text">{title}</h3>
	{#if description}
		<p class="mx-auto mt-1 max-w-md text-sm text-text-muted">{description}</p>
	{/if}
	{#if actions}
		<div class="mt-4 flex flex-wrap justify-center gap-3">
			{@render actions()}
		</div>
	{/if}
</section>
