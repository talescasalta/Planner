<script lang="ts">
	import { resolve } from '$app/paths';
	import { CheckCircle2, Circle, X } from 'lucide-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import type { OnboardingStep } from '$lib/onboarding';

	let {
		steps,
		onDismiss
	}: {
		steps: OnboardingStep[];
		onDismiss: () => void;
	} = $props();

	const doneCount = $derived(steps.filter((step) => step.done).length);
	const nextId = $derived(steps.find((step) => !step.done)?.id);
</script>

<section
	class="rounded-lg border border-primary/30 bg-surface p-4 shadow md:p-5"
	aria-labelledby="onboarding-title"
>
	<header class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<h2 id="onboarding-title" class="text-base font-semibold text-text">
				Primeiros passos
			</h2>
			<p class="mt-0.5 text-sm text-text-muted">
				{doneCount} de {steps.length} concluídos
			</p>
		</div>
		<button
			type="button"
			class="flex h-11 w-11 shrink-0 items-center justify-center rounded text-text-muted hover:bg-canvas hover:text-text md:h-8 md:w-8"
			aria-label="Dispensar primeiros passos"
			onclick={onDismiss}
		>
			<X class="h-4 w-4" />
		</button>
	</header>

	<div
		class="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100"
		aria-hidden="true"
	>
		<div
			class="h-full rounded-full bg-primary transition-all"
			style="width: {Math.round((doneCount / steps.length) * 100)}%"
		></div>
	</div>

	<ol class="mt-4 space-y-3">
		{#each steps as step (step.id)}
			<li class="flex items-start gap-3">
				{#if step.done}
					<CheckCircle2
						class="mt-0.5 h-5 w-5 shrink-0 text-income"
						aria-hidden="true"
					/>
				{:else}
					<Circle
						class="mt-0.5 h-5 w-5 shrink-0 text-gray-300"
						aria-hidden="true"
					/>
				{/if}
				<div class="min-w-0 flex-1">
					<p
						class="text-sm {step.done
							? 'text-text-muted line-through'
							: 'font-medium text-text'}"
					>
						{step.label}
						{#if step.optional}
							<span class="font-normal text-text-muted">(opcional)</span>
						{/if}
						<span class="sr-only">{step.done ? '— concluído' : ''}</span>
					</p>
					{#if !step.done}
						<p class="mt-0.5 text-xs text-text-muted">{step.description}</p>
					{/if}
				</div>
				{#if !step.done}
					<Button
						href={resolve(step.href)}
						size="sm"
						variant={step.id === nextId ? 'primary' : 'secondary'}
						>{step.id === nextId ? 'Começar' : 'Abrir'}</Button
					>
				{/if}
			</li>
		{/each}
	</ol>
</section>
