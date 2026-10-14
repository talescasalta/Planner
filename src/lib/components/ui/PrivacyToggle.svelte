<script lang="ts">
	import { onMount } from 'svelte';
	import { Eye, EyeOff } from 'lucide-svelte';
	import { privacy } from '$lib/privacy.svelte';

	// compact: icon only, for the mobile header.
	let { compact = false }: { compact?: boolean } = $props();

	const iconClass = $derived(compact ? 'h-5 w-5' : 'h-4 w-4');

	onMount(() => privacy.sync());
</script>

<button
	type="button"
	role="switch"
	aria-checked={privacy.on}
	aria-label={compact ? 'Ocultar valores' : undefined}
	title={privacy.on ? 'Mostrar valores' : 'Ocultar valores'}
	onclick={() => privacy.toggle()}
	class="inline-flex min-h-11 items-center gap-3 rounded-md text-sm text-neutral-flow hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary {compact
		? 'min-w-11 justify-center'
		: 'w-full px-2 hover:bg-canvas md:min-h-10'}"
>
	{#if privacy.on}
		<EyeOff class="{iconClass} shrink-0 text-primary" />
	{:else}
		<Eye class="{iconClass} shrink-0" />
	{/if}
	{#if !compact}
		<span class="flex-1 text-left">Ocultar valores</span>
		<span
			class="relative h-5 w-9 shrink-0 rounded-full transition-colors {privacy.on
				? 'bg-primary'
				: 'bg-gray-300'}"
			aria-hidden="true"
		>
			<span
				class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform {privacy.on
					? 'translate-x-4'
					: ''}"
			></span>
		</span>
	{/if}
</button>
