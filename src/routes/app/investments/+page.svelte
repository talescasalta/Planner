<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import CategoryTreemap from '$lib/components/charts/CategoryTreemap.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let ownerFilter: 'todos' | 'meus' = $state('todos');
	let positions = $derived(
		ownerFilter === 'todos'
			? data.positions
			: data.positions.filter((p) => p.ownerUserId === data.currentUserId)
	);
	let total = $derived(positions.reduce((sum, p) => sum + p.value, 0));

	// Positions table: class filter, free-text search and sortable columns.
	type SortKey = 'value' | 'label' | 'classLabel' | 'quantity' | 'price';
	let classFilter = $state('todas');
	let search = $state('');
	let sortKey: SortKey = $state('value');
	let sortAsc = $state(false);

	let classOptions = $derived(
		[...new Set(positions.map((p) => p.classLabel))].sort((a, b) =>
			a.localeCompare(b, 'pt-BR')
		)
	);

	let visiblePositions = $derived.by(() => {
		const term = search.trim().toLowerCase();
		const filtered = positions.filter(
			(p) =>
				(classFilter === 'todas' || p.classLabel === classFilter) &&
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

	const brl = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL'
	});
</script>

<svelte:head>
	<title>Investimentos</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-6 p-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<p class="text-sm text-gray-600">
			{#if data.lastSnapshotDate}
				Última reconciliação com a B3: {data.lastSnapshotDate}. Valores desde
				então são calculados a partir de movimentações e cotações.
			{:else}
				Nenhuma posição importada ainda.
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
				{brl.format(total)}
			</p>
		</div>
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<p class="text-xs text-gray-500">Posições</p>
			<p class="mt-1 text-2xl font-semibold text-gray-900">
				{positions.length}
			</p>
		</div>
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<p class="text-xs text-gray-500">
				Renda passiva recorrente (último mês com dados)
			</p>
			<p class="mt-1 text-2xl font-semibold text-gray-900">
				{lastRecurring === null ? '—' : brl.format(lastRecurring)}
			</p>
		</div>
	</div>

	<div class="rounded-lg border border-gray-200 bg-white p-4">
		<h2 class="mb-2 text-sm font-semibold text-gray-900">
			Alocação por classe
		</h2>
		{#if allocation.length === 0}
			<p class="py-10 text-center text-sm text-gray-500">
				Importe um arquivo de posição da B3 para ver a alocação.
			</p>
		{:else}
			<CategoryTreemap nodes={allocation} height={360} />
		{/if}
	</div>

	<div class="rounded-lg border border-gray-200 bg-white p-4">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-sm font-semibold text-gray-900">Posições</h2>
			{#if positions.length > 0}
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
						{#each classOptions as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				</div>
			{/if}
		</div>
		{#if positions.length === 0}
			<p class="py-6 text-center text-sm text-gray-500">Nada por aqui ainda.</p>
		{:else if visiblePositions.length === 0}
			<p class="py-6 text-center text-sm text-gray-500">
				Nenhum ativo corresponde ao filtro.
			</p>
		{:else}
			<p class="mb-2 text-xs text-gray-500">
				{visiblePositions.length} de {positions.length} posições · {brl.format(
					visibleTotal
				)}
			</p>
			<div class="overflow-x-auto">
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
							<tr class="border-b border-gray-100">
								<td class="py-1 pr-2">
									<span class="font-medium text-gray-900">{position.label}</span
									>
									{#if position.label !== position.name}
										<span class="block max-w-72 truncate text-xs text-gray-500"
											>{position.name}</span
										>
									{/if}
								</td>
								<td class="py-1 pr-2 text-gray-600">{position.classLabel}</td>
								<td class="py-1 pr-2 text-right"
									>{position.quantity.toLocaleString('pt-BR')}</td
								>
								<td class="py-1 pr-2 text-right">
									{position.averageCost === null
										? '—'
										: brl.format(position.averageCost)}
								</td>
								<td class="py-1 pr-2 text-right">
									{position.price === null ? '—' : brl.format(position.price)}
									{#if position.priceDate}
										<span class="block text-[10px] text-gray-400"
											>{position.priceDate}</span
										>
									{/if}
								</td>
								<td class="py-1 text-right font-medium"
									>{brl.format(position.value)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
