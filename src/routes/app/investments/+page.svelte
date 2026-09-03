<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import CategoryTreemap from '$lib/components/charts/CategoryTreemap.svelte';
	import AssetDetailPanel from '$lib/components/investments/AssetDetailPanel.svelte';
	import { CLASS_COLORS, classColor } from '$lib/investments/classes';
	import { brl, dateBr } from '$lib/investments/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let ownerFilter: 'todos' | 'meus' = $state('todos');
	let positions = $derived(
		ownerFilter === 'todos'
			? data.positions
			: data.positions.filter((p) => p.ownerUserId === data.currentUserId)
	);
	let total = $derived(positions.reduce((sum, p) => sum + p.value, 0));

	// Positions table: class filter (shared with the treemap), free-text
	// search and sortable columns.
	type SortKey = 'value' | 'label' | 'classLabel' | 'quantity' | 'price';
	let classFilter = $state('todas');
	let search = $state('');
	let sortKey: SortKey = $state('value');
	let sortAsc = $state(false);
	let selectedAssetId = $state<string | null>(null);

	let classOptions = $derived.by(() => {
		const seen = new SvelteMap<string, string>();
		for (const p of positions) seen.set(p.assetClass, p.classLabel);
		return [...seen.entries()]
			.map(([id, label]) => ({ id, label }))
			.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
	});

	let visiblePositions = $derived.by(() => {
		const term = search.trim().toLowerCase();
		const filtered = positions.filter(
			(p) =>
				(classFilter === 'todas' || p.assetClass === classFilter) &&
				(term === '' ||
					p.label.toLowerCase().includes(term) ||
					p.name.toLowerCase().includes(term))
		);
		const direction = sortAsc ? 1 : -1;
		return [...filtered].sort((a, b) => {
			if (sortKey === 'label' || sortKey === 'classLabel') {
				return a[sortKey].localeCompare(b[sortKey], 'pt-BR') * direction;
			}
			// Assets without a quote sort last regardless of direction, so an
			// unpriced row never looks like the cheapest holding.
			const left = sortKey === 'price' ? a.price : a[sortKey];
			const right = sortKey === 'price' ? b.price : b[sortKey];
			if (left === null) return 1;
			if (right === null) return -1;
			return (left - right) * direction;
		});
	});

	let visibleTotal = $derived(
		visiblePositions.reduce((sum, p) => sum + p.value, 0)
	);

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			sortAsc = !sortAsc;
			return;
		}
		sortKey = key;
		// Text sorts read best A→Z; numbers read best largest-first.
		sortAsc = key === 'label' || key === 'classLabel';
	}

	function sortIndicator(key: SortKey) {
		if (sortKey !== key) return '';
		return sortAsc ? ' ↑' : ' ↓';
	}

	// Class → assets treemap, computed client-side so the owner filter applies.
	let allocation = $derived.by(() => {
		const byClass = new SvelteMap<
			string,
			{
				id: string;
				name: string;
				total: number;
				children: { id: string; name: string; total: number }[];
			}
		>();
		for (const p of positions) {
			if (p.value <= 0) continue;
			const group = byClass.get(p.assetClass) ?? {
				id: p.assetClass,
				name: p.classLabel,
				total: 0,
				children: []
			};
			group.total += p.value;
			group.children.push({ id: p.assetId, name: p.label, total: p.value });
			byClass.set(p.assetClass, group);
		}
		return [...byClass.values()].sort((a, b) => b.total - a.total);
	});

	let lastRecurring = $derived(data.income.at(-1)?.recurring ?? null);

	// Share of the patrimony without a public price: the reader should know how
	// much of the total is carried at the last B3 value.
	let unpricedValue = $derived(
		positions.filter((p) => p.price === null).reduce((s, p) => s + p.value, 0)
	);

	const steps = [
		{
			title: '1. Exporte da B3',
			body: 'Na Área do Investidor (investidor.b3.com.br), baixe os relatórios de Posição, Negociação e Movimentação em xlsx.',
			href: null
		},
		{
			title: '2. Importe aqui',
			body: 'Suba os três arquivos. A posição vira o ponto de partida; a movimentação mantém tudo atualizado depois.',
			href: '/app/investments/import'
		},
		{
			title: '3. Cadastre fundos e previdência',
			body: 'O que não passa pela B3 entra por print da corretora ou pelo assistente, com a cota da CVM.',
			href: '/app/investments/funds'
		}
	] as const;
</script>

<svelte:head>
	<title>Investimentos</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-6 p-4">
	{#if data.positions.length === 0}
		<div class="rounded-lg border border-gray-200 bg-white p-6">
			<h2 class="text-base font-semibold text-gray-900">
				Comece pela carga inicial
			</h2>
			<p class="mt-1 text-sm text-gray-600">
				Três passos e o patrimônio aparece aqui, com alocação, rendimento mensal
				e IR a recolher.
			</p>
			<ol class="mt-4 grid gap-3 sm:grid-cols-3">
				{#each steps as step (step.title)}
					<li class="rounded-lg border border-gray-200 bg-gray-50 p-4">
						<p class="text-sm font-semibold text-gray-900">{step.title}</p>
						<p class="mt-1 text-xs text-gray-600">{step.body}</p>
						{#if step.href}
							<a
								class="mt-3 inline-block rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
								href={resolve(step.href)}
							>
								Abrir
							</a>
						{/if}
					</li>
				{/each}
			</ol>
		</div>
	{:else}
		<div class="flex flex-wrap items-end justify-between gap-3">
			<p class="text-sm text-gray-600">
				{#if data.lastSnapshotDate}
					Última reconciliação com a B3 em {dateBr(data.lastSnapshotDate)}.
					Valores desde então são calculados a partir de movimentações e
					cotações.
				{/if}
			</p>
			{#if data.owners.length > 1}
				<select
					bind:value={ownerFilter}
					class="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
				>
					<option value="todos">Todos do grupo</option>
					<option value="meus">Só os meus</option>
				</select>
			{/if}
		</div>

		{#if data.unknownEventTypes.length > 0}
			<div
				class="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
			>
				Tipos de movimentação não reconhecidos (ignorados na posição, revise):
				{data.unknownEventTypes.join(', ')}
			</div>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<p class="text-xs text-gray-500">Patrimônio total</p>
				<p class="mt-1 text-2xl font-semibold text-gray-900">
					{brl(total)}
				</p>
				{#if unpricedValue > 0}
					<p class="mt-1 text-[11px] text-gray-500">
						{brl(unpricedValue)} sem cotação pública, no último valor da B3.
					</p>
				{/if}
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<p class="text-xs text-gray-500">Posições</p>
				<p class="mt-1 text-2xl font-semibold text-gray-900">
					{positions.length}
				</p>
				<p class="mt-1 text-[11px] text-gray-500">
					em {allocation.length}
					{allocation.length === 1 ? 'classe' : 'classes'}
				</p>
			</div>
			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<p class="text-xs text-gray-500">
					Renda passiva recorrente (último mês com dados)
				</p>
				<p class="mt-1 text-2xl font-semibold text-gray-900">
					{lastRecurring === null ? '—' : brl(lastRecurring)}
				</p>
			</div>
		</div>

		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<div class="mb-2 flex flex-wrap items-baseline justify-between gap-2">
				<h2 class="text-sm font-semibold text-gray-900">Alocação por classe</h2>
				<p class="text-xs text-gray-500">
					Clique numa classe para filtrar a tabela, ou num ativo para abrir o
					detalhe.
				</p>
			</div>
			{#if allocation.length === 0}
				<p class="py-10 text-center text-sm text-gray-500">
					Nenhuma posição com valor para este filtro.
				</p>
			{:else}
				<CategoryTreemap
					nodes={allocation}
					height={360}
					colors={CLASS_COLORS}
					emptyMessage="Nenhuma posição com valor."
					selectedGroupId={classFilter === 'todas' ? null : classFilter}
					onSelectGroup={(id) => (classFilter = id ?? 'todas')}
					onSelect={(sel) => (selectedAssetId = sel?.subcategoryId ?? null)}
				/>
			{/if}
		</div>

		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-sm font-semibold text-gray-900">Posições</h2>
				<div class="flex flex-wrap items-center gap-2">
					<input
						type="search"
						bind:value={search}
						placeholder="Buscar ativo…"
						class="w-44 rounded border border-gray-300 px-2 py-1 text-sm"
					/>
					<select
						bind:value={classFilter}
						class="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
					>
						<option value="todas">Todas as classes</option>
						{#each classOptions as option (option.id)}
							<option value={option.id}>{option.label}</option>
						{/each}
					</select>
				</div>
			</div>
			{#if visiblePositions.length === 0}
				<p class="py-6 text-center text-sm text-gray-500">
					Nenhum ativo corresponde ao filtro.
				</p>
			{:else}
				<p class="mb-2 text-xs text-gray-500">
					{visiblePositions.length} de {positions.length} posições · {brl(
						visibleTotal
					)}
				</p>

				<!-- Desktop: full table -->
				<div class="hidden overflow-x-auto sm:block">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b text-xs text-gray-500">
								<th class="py-1 pr-2">
									<button
										type="button"
										class="hover:text-gray-900"
										onclick={() => toggleSort('label')}
										>Ativo{sortIndicator('label')}</button
									>
								</th>
								<th class="py-1 pr-2">
									<button
										type="button"
										class="hover:text-gray-900"
										onclick={() => toggleSort('classLabel')}
										>Classe{sortIndicator('classLabel')}</button
									>
								</th>
								<th class="py-1 pr-2 text-right">
									<button
										type="button"
										class="hover:text-gray-900"
										onclick={() => toggleSort('quantity')}
										>Quantidade{sortIndicator('quantity')}</button
									>
								</th>
								<th class="py-1 pr-2 text-right">Preço médio</th>
								<th class="py-1 pr-2 text-right">
									<button
										type="button"
										class="hover:text-gray-900"
										onclick={() => toggleSort('price')}
										>Cotação{sortIndicator('price')}</button
									>
								</th>
								<th class="py-1 text-right">
									<button
										type="button"
										class="hover:text-gray-900"
										onclick={() => toggleSort('value')}
										>Valor{sortIndicator('value')}</button
									>
								</th>
							</tr>
						</thead>
						<tbody>
							{#each visiblePositions as position (position.assetId)}
								<tr
									class="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
									onclick={() => (selectedAssetId = position.assetId)}
								>
									<td class="py-1 pr-2">
										<button
											type="button"
											class="text-left font-medium text-gray-900 hover:underline"
											onclick={(e) => {
												e.stopPropagation();
												selectedAssetId = position.assetId;
											}}
										>
											{position.label}
										</button>
										{#if position.label !== position.name}
											<span
												class="block max-w-72 truncate text-xs text-gray-500"
												>{position.name}</span
											>
										{/if}
									</td>
									<td class="py-1 pr-2 text-gray-600">
										<span class="inline-flex items-center gap-1.5">
											<span
												class="inline-block h-2 w-2 rounded-full"
												style={`background:${classColor(position.assetClass)}`}
											></span>
											{position.classLabel}
										</span>
									</td>
									<td class="py-1 pr-2 text-right"
										>{position.quantity.toLocaleString('pt-BR')}</td
									>
									<td class="py-1 pr-2 text-right">
										{position.averageCost === null
											? '—'
											: brl(position.averageCost)}
									</td>
									<td class="py-1 pr-2 text-right">
										{position.price === null ? '—' : brl(position.price)}
										{#if position.priceDate}
											<span class="block text-[10px] text-gray-400"
												>{dateBr(position.priceDate)}</span
											>
										{/if}
									</td>
									<td class="py-1 text-right font-medium"
										>{brl(position.value)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Mobile: one card per holding -->
				<ul class="divide-y divide-gray-100 sm:hidden">
					{#each visiblePositions as position (position.assetId)}
						<li>
							<button
								type="button"
								class="flex w-full items-center justify-between gap-3 py-2 text-left"
								onclick={() => (selectedAssetId = position.assetId)}
							>
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-gray-900">
										{position.label}
									</p>
									<p class="flex items-center gap-1.5 text-xs text-gray-500">
										<span
											class="inline-block h-2 w-2 rounded-full"
											style={`background:${classColor(position.assetClass)}`}
										></span>
										{position.classLabel} · {position.quantity.toLocaleString(
											'pt-BR'
										)} un.
									</p>
								</div>
								<div class="text-right">
									<p class="text-sm font-medium text-gray-900">
										{brl(position.value)}
									</p>
									<p class="text-[11px] text-gray-500">
										{position.price === null
											? 'sem cotação'
											: brl(position.price)}
									</p>
								</div>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<AssetDetailPanel
	assetId={selectedAssetId}
	onClose={() => (selectedAssetId = null)}
/>
