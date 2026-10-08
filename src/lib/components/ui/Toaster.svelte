<script lang="ts">
	import { toast } from '$lib/toast.svelte';

	const KIND_CLASS = {
		success: 'border-l-4 border-income',
		error: 'border-l-4 border-danger',
		info: 'border-l-4 border-primary'
	};
</script>

<div
	class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:inset-x-auto md:right-4 md:bottom-4 md:items-end"
	aria-live="polite"
	aria-atomic="false"
>
	{#each toast.items as item (item.id)}
		<div
			role={item.kind === 'error' ? 'alert' : 'status'}
			class="pointer-events-auto flex max-w-sm items-center gap-3 rounded bg-surface px-4 py-3 text-sm text-text shadow-lg {KIND_CLASS[
				item.kind
			]}"
		>
			<span>{item.message}</span>
			{#if item.action}
				{@const action = item.action}
				<button
					type="button"
					class="shrink-0 font-medium text-primary hover:underline"
					onclick={() => {
						action.onClick();
						toast.dismiss(item.id);
					}}>{action.label}</button
				>
			{/if}
		</div>
	{/each}
</div>
