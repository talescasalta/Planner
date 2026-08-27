<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { scaleBand } from 'd3-scale';
	import { Axis, Chart, Spline, Svg } from 'layerchart';
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

	let evolutionData = $derived(
		data.evolution.map((point) => ({ ...point, label: point.date.slice(0, 7) }))
	);
	let evolutionMax = $derived(
		Math.max(0, ...data.evolution.map((p) => p.totalValue))
	);
	let incomeMax = $derived(Math.max(1, ...data.income.map((i) => i.total)));

	const brl = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL'
	});
	const brlCompact = (value: number) =>
		Math.abs(value) >= 1000
			? `R$ ${(value / 1000).toFixed(0)}k`
			: brl.format(value);
</script>

<svelte:head>
	<title>Investimentos</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-6 p-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold text-gray-900">
				Patrimônio em investimentos
			</h1>
			<p class="mt-1 text-sm text-gray-600">
				{#if data.lastSnapshotDate}
					Última reconciliação com a B3: {data.lastSnapshotDate}. Valores desde
					então são calculados a partir de movimentações e cotações.
				{:else}
					Nenhuma posição importada ainda.
				{/if}
			</p>
		</div>
		<div class="flex items-center gap-3">
			{#if data.owners.length > 1}
				<select
					bind:value={ownerFilter}
					class="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
				>
					<option value="todos">Todos do grupo</option>
					<option value="meus">Só os meus</option>
				</select>
			{/if}
			<a
				href={resolve('/app/investments/import')}
				class="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				Importar arquivos da B3
			</a>
			<a
				href={resolve('/app/investments/taxes')}
				class="text-sm text-blue-700 underline"
			>
				IR a recolher
			</a>
		</div>
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
			<p class="text-xs text-gray-500">Renda passiva (último mês com dados)</p>
			<p class="mt-1 text-2xl font-semibold text-gray-900">
				{data.income.length > 0 ? brl.format(data.income.at(-1)!.total) : '—'}
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

	<div class="grid gap-4 lg:grid-cols-2">
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<h2 class="mb-2 text-sm font-semibold text-gray-900">
				Evolução do patrimônio
			</h2>
			{#if evolutionData.length < 2}
				<p class="py-10 text-center text-sm text-gray-500">
					Cada import de posição adiciona um ponto à curva.
				</p>
			{:else}
				<div class="h-64 w-full">
					<Chart
						data={evolutionData}
						x="date"
						xScale={scaleBand().padding(0.1)}
						y="totalValue"
						yDomain={[0, evolutionMax]}
						yNice
						padding={{ top: 16, right: 16, bottom: 28, left: 64 }}
					>
						<Svg>
							<Axis
								placement="left"
								grid
								rule
								format={(v: number) => brlCompact(v)}
							/>
							<Axis
								placement="bottom"
								rule
								format={(d: string) => d.slice(0, 7)}
							/>
							<Spline class="stroke-blue-600 stroke-2 fill-none" />
						</Svg>
					</Chart>
				</div>
				<p class="mt-1 text-xs text-gray-500">
					Pontos oficiais (posições B3) + ponto atual calculado por cotações.
				</p>
			{/if}
		</div>

		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<h2 class="mb-2 text-sm font-semibold text-gray-900">
				Renda passiva mensal
			</h2>
			{#if data.income.length === 0}
				<p class="py-10 text-center text-sm text-gray-500">
					Importe a movimentação da B3 para ver rendimentos e juros.
				</p>
			{:else}
				<div class="space-y-1">
					{#each data.income as row (row.month)}
						<div class="flex items-center gap-2 text-xs">
							<span class="w-14 text-gray-500">{row.month}</span>
							<div class="h-4 flex-1 rounded bg-gray-100">
								<div
									class="h-4 rounded bg-emerald-500"
									style={`width: ${Math.max(2, (row.total / incomeMax) * 100)}%`}
								></div>
							</div>
							<span class="w-24 text-right text-gray-700"
								>{brl.format(row.total)}</span
							>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="rounded-lg border border-gray-200 bg-white p-4">
		<h2 class="mb-2 text-sm font-semibold text-gray-900">Posições</h2>
		{#if positions.length === 0}
			<p class="py-6 text-center text-sm text-gray-500">Nada por aqui ainda.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b text-xs text-gray-500">
							<th class="py-1 pr-2">Ativo</th>
							<th class="py-1 pr-2">Classe</th>
							<th class="py-1 pr-2 text-right">Quantidade</th>
							<th class="py-1 pr-2 text-right">Preço médio</th>
							<th class="py-1 pr-2 text-right">Cotação</th>
							<th class="py-1 text-right">Valor</th>
						</tr>
					</thead>
					<tbody>
						{#each positions as position (position.assetId)}
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
