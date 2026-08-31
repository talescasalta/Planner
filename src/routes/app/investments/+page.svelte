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

	let evolutionData = $derived(
		data.evolution.map((point) => ({ ...point, label: point.date.slice(0, 7) }))
	);
	let evolutionMax = $derived(
		Math.max(0, ...data.evolution.map((p) => p.totalValue))
	);
	let incomeMax = $derived(Math.max(1, ...data.income.map((i) => i.recurring)));
	let maturityMonths = $derived(data.income.filter((i) => i.maturity > 0));
	let lastRecurring = $derived(data.income.at(-1)?.recurring ?? null);

	let perf = $derived(data.performance.sinceInception);
	const pct = (rate: number) => `${(rate * 100).toFixed(2)}%`;

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
				href={resolve('/app/investments/returns')}
				class="text-sm text-blue-700 underline"
			>
				Rendimento mensal
			</a>
			<a
				href={resolve('/app/investments/funds')}
				class="text-sm text-blue-700 underline"
			>
				Fundos
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
			<p class="text-xs text-gray-500">
				Renda passiva recorrente (último mês com dados)
			</p>
			<p class="mt-1 text-2xl font-semibold text-gray-900">
				{lastRecurring === null ? '—' : brl.format(lastRecurring)}
			</p>
		</div>
	</div>

	<div class="rounded-lg border border-gray-200 bg-white p-4">
		<h2 class="text-sm font-semibold text-gray-900">Rentabilidade vs CDI</h2>
		{#if perf}
			<div class="mt-3 flex flex-wrap items-end gap-6">
				<div>
					<p class="text-xs text-gray-500">Sua carteira (a.a.)</p>
					<p class="text-2xl font-semibold text-gray-900">
						{pct(perf.portfolioAnnual)}
					</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">CDI no mesmo período (a.a.)</p>
					<p class="text-2xl font-semibold text-gray-600">
						{pct(perf.cdiAnnual)}
					</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Equivalente a</p>
					<p
						class={perf.percentOfCdi !== null && perf.percentOfCdi >= 100
							? 'text-2xl font-semibold text-emerald-700'
							: 'text-2xl font-semibold text-amber-700'}
					>
						{perf.percentOfCdi === null
							? '—'
							: `${perf.percentOfCdi.toFixed(1)}% do CDI`}
					</p>
				</div>
			</div>
			<p class="mt-2 text-xs text-gray-500">
				Retorno ponderado pelo dinheiro (XIRR) de {perf.from} até {perf.to},
				sobre aportes, resgates e proventos — cobrindo {data.performance.coveragePercent.toFixed(
					0
				)}% do patrimônio.
			</p>
			{#if data.performance.excludedLabels.length > 0}
				<div
					class="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
				>
					<p>
						<strong>Número pouco confiável.</strong> A B3 não registra o custo
						de entrada de {data.performance.excludedLabels.length} ativos ({(
							100 - data.performance.coveragePercent
						).toFixed(0)}% do patrimônio), que ficam fora da conta: eles
						chegaram por transferência de corretora ou são anteriores ao
						histórico disponível. Como o resultado é bem sensível a essas
						lacunas, trate-o como ordem de grandeza, não como medida.
					</p>
					<p class="mt-1">
						Para torná-lo confiável, informe o custo inicial de
						{data.performance.excludedLabels.join(', ')} em
						<a class="underline" href={resolve('/app/investments/taxes')}
							>IR a recolher</a
						>.
					</p>
				</div>
			{/if}
		{:else}
			<p class="mt-3 text-sm text-gray-500">
				Ainda não há dados suficientes para calcular a rentabilidade. É preciso
				ter movimentações importadas e a série do CDI, que o cron busca no Banco
				Central.
			</p>
		{/if}

		{#if data.performance.curve.length >= 2}
			<div class="mt-4 border-t border-gray-100 pt-3">
				<p class="mb-2 text-xs text-gray-500">
					Evolução comparada (base 100 em {data.performance.curve[0].date}) —
					carteira <span class="font-medium text-blue-700">azul</span>, CDI
					<span class="font-medium text-gray-500">cinza</span>
				</p>
				<div class="space-y-1">
					{#each data.performance.curve.slice(-10) as point (point.date)}
						<div class="flex items-center gap-2 text-xs">
							<span class="w-20 text-gray-500">{point.date}</span>
							<span class="w-16 text-right font-medium text-blue-700"
								>{point.portfolioIndex.toFixed(2)}</span
							>
							<span class="w-16 text-right text-gray-500"
								>{point.cdiIndex.toFixed(2)}</span
							>
						</div>
					{/each}
				</div>
			</div>
		{:else}
			<p class="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
				A curva diária vs CDI começa a existir conforme o cron registra as
				cotações — hoje há {data.performance.curve.length === 0
					? 'menos de dois dias'
					: 'apenas um dia'} de preços. Diferente do número acima, ela não depende
				de custo de entrada: compara o valor da carteira dia a dia, descontando aportes,
				então será a medida confiável daqui pra frente.
			</p>
		{/if}
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
									style={`width: ${Math.max(2, (row.recurring / incomeMax) * 100)}%`}
								></div>
							</div>
							<span class="w-24 text-right text-gray-700"
								>{brl.format(row.recurring)}</span
							>
						</div>
					{/each}
				</div>
				{#if maturityMonths.length > 0}
					<p class="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500">
						Fora da série (juros liberados no vencimento do papel, referentes a
						todo o período de aplicação):
						{#each maturityMonths as row, index (row.month)}{index > 0
								? ', '
								: ' '}{row.month} — {brl.format(row.maturity)}{/each}
					</p>
				{/if}
			{/if}
		</div>
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
