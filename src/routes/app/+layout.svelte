<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Menu } from 'lucide-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import {
		BOTTOM_BAR_ITEMS,
		NAV_ITEMS,
		NAV_SECTIONS,
		isActive,
		type NavItem
	} from '$lib/navigation';

	let { data, children } = $props();

	const REVIEW_HREF = '/app/review';
	const BADGE_CAP = 99;
	const dailyItems = NAV_ITEMS.filter((item) => item.section === 'daily');
	const tabClass =
		'relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]';

	let moreOpen = $state(false);

	const pathname = $derived(page.url.pathname);
	const currentLabel = $derived(
		NAV_ITEMS.find((item) => isActive(pathname, item.href))?.label ?? ''
	);
	// "Mais" lights up when the current page is not one of the bottom tabs,
	// and, from md up, when it is not one of the header links.
	const moreActive = $derived(
		!BOTTOM_BAR_ITEMS.some((item) => isActive(pathname, item.href)) &&
			currentLabel !== ''
	);
	const headerMoreActive = $derived(
		!dailyItems.some((item) => isActive(pathname, item.href)) &&
			currentLabel !== ''
	);
	const reviewCount = $derived(data.reviewCount ?? 0);
	const reviewBadge = $derived(
		reviewCount > BADGE_CAP ? `${BADGE_CAP}+` : String(reviewCount)
	);

	function tabColor(active: boolean) {
		return active ? 'text-primary font-medium' : 'text-neutral-flow';
	}

	function itemLabel(item: NavItem) {
		if (item.href === REVIEW_HREF && reviewCount > 0) {
			return `${item.label}, ${reviewCount} pendentes`;
		}
		return item.shortLabel ?? item.label;
	}
</script>

{#snippet reviewPill(item: NavItem, classes: string)}
	{#if item.href === REVIEW_HREF && reviewCount > 0}
		<span
			class="min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-medium text-white {classes}"
			aria-hidden="true">{reviewBadge}</span
		>
	{/if}
{/snippet}

{#snippet logout(classes: string)}
	<form method="POST" action="/logout" use:enhance class={classes}>
		<Button type="submit" variant="ghost" size="sm" class="w-full justify-start"
			>Sair</Button
		>
	</form>
{/snippet}

<div class="min-h-screen bg-canvas lg:pl-60">
	<aside
		class="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-border bg-surface lg:flex"
	>
		<p class="px-5 py-5 text-lg font-semibold text-text">Planner</p>
		<nav
			class="flex-1 space-y-5 overflow-y-auto px-3 pb-4"
			aria-label="Navegação principal"
		>
			{#each NAV_SECTIONS as section (section.id)}
				<div>
					<p
						class="px-2 pb-1 text-[11px] font-medium tracking-wider text-text-muted uppercase"
					>
						{section.label}
					</p>
					<ul class="space-y-0.5">
						{#each NAV_ITEMS.filter((item) => item.section === section.id) as item (item.href)}
							{@const active = isActive(pathname, item.href)}
							{@const Icon = item.icon}
							<li>
								<a
									href={resolve(item.href as '/app')}
									aria-current={active ? 'page' : undefined}
									aria-label={itemLabel(item) === item.label
										? undefined
										: itemLabel(item)}
									class="flex min-h-10 items-center gap-3 rounded-md px-2 text-sm hover:bg-canvas {active
										? 'bg-primary-soft font-medium text-primary'
										: 'text-gray-700'}"
								>
									<Icon class="h-4 w-4 shrink-0" />
									<span class="flex-1">{item.label}</span>
									{@render reviewPill(item, '')}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>
		<div class="border-t border-border p-3">
			{@render logout('')}
		</div>
	</aside>

	<header class="bg-surface shadow lg:hidden">
		<div
			class="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3"
		>
			<p class="text-lg font-semibold text-text">Planner</p>
			<h1 class="truncate text-sm text-neutral-flow md:hidden">
				{currentLabel}
			</h1>
			<nav
				class="hidden items-center gap-x-4 md:flex"
				aria-label="Navegação principal"
			>
				{#each dailyItems as item (item.href)}
					{@const active = isActive(pathname, item.href)}
					<a
						href={resolve(item.href as '/app')}
						aria-current={active ? 'page' : undefined}
						class="flex items-center gap-1.5 text-sm hover:text-text {active
							? 'font-medium text-primary'
							: 'text-neutral-flow'}"
						>{item.label}{@render reviewPill(item, '')}</a
					>
				{/each}
				<button
					type="button"
					class="inline-flex min-h-10 items-center gap-1 text-sm hover:text-text {headerMoreActive
						? 'font-medium text-primary'
						: 'text-neutral-flow'}"
					aria-haspopup="dialog"
					onclick={() => (moreOpen = true)}
				>
					<Menu class="h-4 w-4" /> Mais
				</button>
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-7xl px-4 py-6 pb-24 md:pb-6">
		{@render children()}
	</main>

	<nav
		class="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
		aria-label="Navegação principal"
	>
		{#each BOTTOM_BAR_ITEMS as item (item.href)}
			{@const active = isActive(pathname, item.href)}
			{@const Icon = item.icon}
			<a
				href={resolve(item.href as '/app')}
				aria-current={active ? 'page' : undefined}
				aria-label={itemLabel(item)}
				class="{tabClass} {tabColor(active)}"
			>
				<span class="relative">
					<Icon class="h-5 w-5" />
					{@render reviewPill(item, 'absolute -top-1.5 left-3')}
				</span>
				<span aria-hidden="true">{item.shortLabel ?? item.label}</span>
			</a>
		{/each}
		<button
			type="button"
			class="{tabClass} {tabColor(moreActive)}"
			aria-haspopup="dialog"
			onclick={() => (moreOpen = true)}
		>
			<Menu class="h-5 w-5" />
			<span>Mais</span>
		</button>
	</nav>
</div>

<Toaster />

<Sheet open={moreOpen} title="Mais" onClose={() => (moreOpen = false)}>
	{#each NAV_SECTIONS as section (section.id)}
		<p
			class="pt-3 pb-1 text-[11px] font-medium tracking-wider text-text-muted uppercase first:pt-0"
		>
			{section.label}
		</p>
		<ul class="divide-y divide-gray-100">
			{#each NAV_ITEMS.filter((item) => item.section === section.id) as item (item.href)}
				{@const active = isActive(pathname, item.href)}
				{@const Icon = item.icon}
				<li>
					<a
						href={resolve(item.href as '/app')}
						aria-current={active ? 'page' : undefined}
						onclick={() => (moreOpen = false)}
						class="flex min-h-11 items-center gap-3 py-2 text-sm {active
							? 'font-medium text-primary'
							: 'text-gray-800'}"
					>
						<Icon class="h-5 w-5" />
						<span class="flex-1">{item.label}</span>
						{@render reviewPill(item, '')}
					</a>
				</li>
			{/each}
		</ul>
	{/each}
	<div class="mt-3 border-t border-gray-100 pt-2">
		{@render logout('')}
	</div>
</Sheet>
