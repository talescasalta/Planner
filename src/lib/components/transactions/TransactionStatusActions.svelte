<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { Ban, Check, Undo2 } from 'lucide-svelte';
	import type { Transaction } from '$lib/types/app';

	type Status = Transaction['review_status'];
	type ActionKey = 'confirm' | 'ignore' | 'restore';

	let {
		tx,
		busy,
		enhanceFor,
		size
	}: {
		tx: Transaction;
		busy: boolean;
		enhanceFor: (tx: Transaction, status: Status) => ReturnType<SubmitFunction>;
		size: 'compact' | 'touch';
	} = $props();

	const ACTIONS = {
		confirm: {
			action: '?/confirm_single',
			next: 'confirmed',
			label: 'Confirmar',
			title: 'Confirmar transação',
			icon: Check,
			color: 'bg-green-600 text-white hover:bg-green-700 disabled:bg-green-300'
		},
		ignore: {
			action: '?/ignore_single',
			next: 'ignored',
			label: 'Ignorar',
			title: 'Ignorar transação nos totais',
			icon: Ban,
			color: 'bg-gray-600 text-white hover:bg-gray-700 disabled:bg-gray-300'
		},
		restore: {
			action: '?/restore_single',
			next: 'needs_review',
			label: 'Revisar',
			title: 'Voltar para revisão',
			icon: Undo2,
			color:
				'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 disabled:text-gray-300'
		}
	} as const;

	const BADGES: Record<string, { text: string; color: string }> = {
		needs_review: { text: 'Revisar', color: 'bg-yellow-100 text-yellow-800' },
		confirmed: { text: 'Confirmado', color: 'bg-green-100 text-green-800' },
		ignored: { text: 'Ignorado', color: 'bg-gray-100 text-gray-800' }
	};
	const FALLBACK_BADGE = 'bg-gray-100 text-gray-800';

	const BUTTONS_BY_STATUS: Record<string, ActionKey[]> = {
		needs_review: ['confirm', 'ignore'],
		confirmed: ['ignore'],
		ignored: ['restore']
	};

	const BUTTON_BASE =
		'inline-flex items-center justify-center shadow-sm disabled:cursor-not-allowed';
	const SIZE_CLASS = {
		compact: 'h-7 w-7 rounded-full',
		touch: 'min-h-11 gap-1.5 rounded-md px-3 text-sm font-medium'
	};

	const badge = $derived(BADGES[tx.review_status]);
	const keys = $derived(BUTTONS_BY_STATUS[tx.review_status] ?? []);
</script>

<div class="flex flex-wrap items-center gap-2">
	<span
		class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium {badge?.color ??
			FALLBACK_BADGE}">{badge?.text ?? tx.review_status}</span
	>
	{#each keys as key (key)}
		{@const item = ACTIONS[key]}
		{@const Icon = item.icon}
		<form
			method="POST"
			action={item.action}
			use:enhance={() => enhanceFor(tx, item.next)}
			data-sveltekit-noscroll
		>
			<input type="hidden" name="transaction_id" value={tx.id} />
			<button
				type="submit"
				disabled={busy}
				class="{BUTTON_BASE} {SIZE_CLASS[size]} {item.color}"
				title={item.title}
				aria-label={size === 'compact' ? item.title : undefined}
			>
				<Icon class="h-4 w-4" />
				{#if size === 'touch'}{item.label}{/if}
			</button>
		</form>
	{/each}
</div>
