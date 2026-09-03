<script lang="ts">
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import {
		brlCompact,
		cdiClass,
		dateBr,
		gainClass,
		monthShort,
		percentOfCdi,
		signedBrl,
		signedPct
	} from '$lib/investments/format';
	import type { LayoutData } from './$types';

	let {
		data,
		children
	}: { data: LayoutData; children: import('svelte').Snippet } = $props();

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

	let overview = $derived(data.overview);

	// Freshness in one place: the newest priced day and how far the CDI series
	// reaches. A running month measured against a short CDI flatters the
	// comparison, so the strip says so instead of leaving it to each page.
	let cdiLagging = $derived(
		overview.cdiThrough !== null &&
			overview.monthEnd !== '' &&
			overview.cdiThrough < overview.monthEnd
	);
</script>

<div class="mx-auto max-w-7xl px-4 pt-4">
	<div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
		<h1 class="text-xl font-semibold text-gray-900">Investimentos</h1>
		{#if overview.hasData}
			<dl
				class="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm"
				aria-label="Resumo da carteira"
			>
				<div class="flex items-baseline gap-1.5">
					<dt class="text-xs text-gray-500">Patrimônio</dt>
					<dd
						class="font-semibold text-gray-900"
						title={overview.totalValue.toLocaleString('pt-BR', {
							style: 'currency',
							currency: 'BRL'
						})}
					>
						{brlCompact(overview.totalValue)}
					</dd>
				</div>
				<div class="flex items-baseline gap-1.5">
					<dt class="text-xs text-gray-500">{monthShort(overview.month)}</dt>
					<dd class={`font-semibold ${gainClass(overview.monthGain)}`}>
						{signedBrl(overview.monthGain)}
						<span class="font-normal"
							>({signedPct(overview.monthReturnRate)})</span
						>
					</dd>
					<dd class={`text-xs ${cdiClass(overview.monthPercentOfCdi)}`}>
						{percentOfCdi(overview.monthPercentOfCdi)}{cdiLagging ? '*' : ''}
					</dd>
				</div>
				<div class="flex items-baseline gap-1.5 text-xs text-gray-500">
					<dt>Cotações de</dt>
					<dd class="text-gray-700">
						{dateBr(overview.lastQuoteDate ?? overview.lastSnapshotDate)}
					</dd>
					{#if overview.cdiThrough}
						<dt>· CDI até</dt>
						<dd class={cdiLagging ? 'text-amber-700' : 'text-gray-700'}>
							{dateBr(overview.cdiThrough)}
						</dd>
					{/if}
				</div>
			</dl>
		{/if}
	</div>
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
