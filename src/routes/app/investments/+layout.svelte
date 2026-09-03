<script lang="ts">
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';

	let { children } = $props();

	// One bar for the whole section, so moving between views is a single click
	// from anywhere and the current one is always visible. Each tab is still a
	// real route — the back button, refresh and deep links keep working — but
	// only the panel below re-renders, so the bar never flickers or moves.
	const tabs = [
		{ href: '/app/investments', label: 'Patrimônio' },
		{ href: '/app/investments/returns', label: 'Rendimento' },
		{ href: '/app/investments/taxes', label: 'IR' },
		{ href: '/app/investments/funds', label: 'Fundos' },
		{ href: '/app/investments/import', label: 'Importar' },
		{ href: '/app/investments/assistant', label: 'Assistente' }
	] as const;

	// The overview lives at the section root, so it must match exactly or every
	// tab would read as active.
	let current = $derived($page.url.pathname.replace(/\/$/, ''));
	const isActive = (href: string) =>
		href === '/app/investments' ? current === href : current.startsWith(href);
</script>

<div class="mx-auto max-w-7xl px-4 pt-4">
	<h1 class="text-xl font-semibold text-gray-900">Investimentos</h1>
	<nav
		class="mt-3 flex gap-1 overflow-x-auto border-b border-gray-200"
		aria-label="Seções de investimentos"
	>
		{#each tabs as tab (tab.href)}
			<a
				href={resolve(tab.href)}
				aria-current={isActive(tab.href) ? 'page' : undefined}
				class={isActive(tab.href)
					? 'border-b-2 border-blue-600 px-3 py-2 text-sm font-medium whitespace-nowrap text-blue-700'
					: 'border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-gray-600 hover:border-gray-300 hover:text-gray-900'}
			>
				{tab.label}
			</a>
		{/each}
	</nav>
</div>

{@render children()}
