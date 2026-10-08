<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Menu } from 'lucide-svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import { NAV_ITEMS, isActive, type NavItem } from '$lib/navigation';

	let { data, children } = $props();

	const primaryItems = NAV_ITEMS.filter((item) => item.primary);
	const moreItems = NAV_ITEMS.filter((item) => !item.primary);
	const REVIEW_HREF = '/app/review';
	const BADGE_CAP = 99;
	const tabClass =
		'relative flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]';

	let moreOpen = $state(false);

	const currentLabel = $derived(
		NAV_ITEMS.find((item) => isActive(page.url.pathname, item.href))?.label ??
			''
	);
	const moreActive = $derived(
		moreItems.some((item) => isActive(page.url.pathname, item.href))
	);
	const reviewCount = $derived(data.reviewCount ?? 0);
	const reviewBadge = $derived(
		reviewCount > BADGE_CAP ? `${BADGE_CAP}+` : String(reviewCount)
	);

	function tabColor(active: boolean) {
		return active ? 'text-indigo-700 font-medium' : 'text-gray-600';
	}

	function itemLabel(item: NavItem) {
		if (item.href === REVIEW_HREF && reviewCount > 0) {
			return `${item.label}, ${reviewCount} pendentes`;
		}
		return item.shortLabel ?? item.label;
	}
</script>

<div class="min-h-screen bg-gray-50">
	<header class="bg-white shadow">
		<div
			class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4"
		>
			<h1 class="text-lg font-semibold text-gray-900">Finanças</h1>
			<span class="truncate text-sm text-gray-600 md:hidden"
				>{currentLabel}</span
			>
			<nav
				class="hidden flex-wrap items-center justify-end gap-x-4 gap-y-1 md:flex"
			>
				{#each NAV_ITEMS as item (item.href)}
					{@const active = isActive(page.url.pathname, item.href)}
					<a
						href={resolve(item.href as '/app')}
						aria-current={active ? 'page' : undefined}
						class="text-sm hover:text-gray-900 {active
							? 'text-indigo-700 font-medium'
							: 'text-gray-600'}">{item.label}</a
					>
				{/each}
				<form method="POST" action="/logout" use:enhance class="inline">
					<button type="submit" class="text-sm text-red-600 hover:text-red-800"
						>Sair</button
					>
				</form>
			</nav>
		</div>
	</header>

	<main class="max-w-7xl mx-auto px-4 py-6 pb-24 md:pb-6">
		{@render children()}
	</main>

	<nav
		class="fixed inset-x-0 bottom-0 z-20 flex border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
		aria-label="Navegação principal"
	>
		{#each primaryItems as item (item.href)}
			{@const active = isActive(page.url.pathname, item.href)}
			{@const Icon = item.icon}
			<a
				href={resolve(item.href as '/app')}
				aria-current={active ? 'page' : undefined}
				aria-label={itemLabel(item)}
				class="{tabClass} {tabColor(active)}"
			>
				<span class="relative">
					<Icon class="h-5 w-5" />
					{#if item.href === REVIEW_HREF && reviewCount > 0}
						<span
							class="absolute -top-1.5 left-3 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-medium text-white"
							aria-hidden="true">{reviewBadge}</span
						>
					{/if}
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
	<ul class="divide-y divide-gray-100">
		{#each moreItems as item (item.href)}
			{@const active = isActive(page.url.pathname, item.href)}
			{@const Icon = item.icon}
			<li>
				<a
					href={resolve(item.href as '/app')}
					aria-current={active ? 'page' : undefined}
					onclick={() => (moreOpen = false)}
					class="flex min-h-11 items-center gap-3 py-2 text-sm {active
						? 'text-indigo-700 font-medium'
						: 'text-gray-800'}"
				>
					<Icon class="h-5 w-5" />
					{item.label}
				</a>
			</li>
		{/each}
	</ul>
	<form
		method="POST"
		action="/logout"
		use:enhance
		class="mt-2 border-t border-gray-100 pt-2"
	>
		<button
			type="submit"
			class="min-h-11 w-full text-left text-sm text-red-600 hover:text-red-800"
			>Sair</button
		>
	</form>
</Sheet>
