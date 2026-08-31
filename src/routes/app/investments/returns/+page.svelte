<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let selectedMonth = $state(0);
	let ownerFilter: 'todos' | 'meus' = $state('todos');
	let onlyMovers = $state(true);

	let month = $derived(data.months[selectedMonth]);
	let rows = $derived.by(() => {
		if (!month) return [];
		return month.assets.filter((asset) => {
			const info = data.labels[asset.assetId];
			if (ownerFilter === 'meus' && info?.owner !== data.currentUserId)
				return false;
			// A holding that neither moved nor could be measured adds nothing.
			if (onlyMovers && !asset.unpriced && Math.abs(asset.gain) < 0.005)
				return false;
			return true;
		});
	});

	const brl = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL'
	});
	const pct = (rate: number | null) =>
		rate === null ? '—' : `${(rate * 100).toFixed(2)}%`;
	const monthName = (key: string) => {
		const [year, monthNumber] = key.split('-').map(Number);
		return new Date(year, monthNumber - 1, 1)
			.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
			.replace(/^./, (c) => c.toUpperCase());
	};
	const cdiClass = (value: number | null) =>
		value === null
			? 'text-gray-400'
			: value >= 100
				? 'text-emerald-700'
				: value >= 0
					? 'text-amber-700'
					: 'text-red-700';
</script>

<svelte:head>
	<title>Rendimento mensal</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 p-4">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-xl font-semibold text-gray-900">Rendimento mensal</h1>
			<p class="mt-1 text-sm text-gray-600">
				Quanto a carteira rendeu no mês, já descontando aportes e resgates, e
				quanto isso representa do CDI do mesmo período.
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
				href={resolve('/app/investments')}
				class="text-sm text-blue-700 underline"
			>
				Patrimônio
			</a>
		</div>
	</div>

	{#if data.months.length === 0}
		<div
			class="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500"
		>
			Sem dados suficientes. Importe os arquivos da B3 em
			<a
				class="text-blue-700 underline"
				href={resolve('/app/investments/import')}
			>
				Importar</a
			>.
		</div>
	{:else}
		<div class="flex flex-wrap gap-2">
			{#each data.months as m, index (m.month)}
				<button
					type="button"
					onclick={() => (selectedMonth = index)}
					class={index === selectedMonth
						? 'rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white'
						: 'rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50'}
				>
					{monthName(m.month)}
				</button>
			{/each}
		</div>

		{#if month}
			<div class="grid gap-4 sm:grid-cols-4">
				<div class="rounded-lg border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Rendeu no mês</p>
					<p
						class={month.gain >= 0
							? 'mt-1 text-2xl font-semibold text-emerald-700'
							: 'mt-1 text-2xl font-semibold text-red-700'}
					>
						{brl.format(month.gain)}
					</p>
				</div>
				<div class="rounded-lg border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Rentabilidade</p>
					<p class="mt-1 text-2xl font-semibold text-gray-900">
						{pct(month.returnRate)}
					</p>
				</div>
				<div class="rounded-lg border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">CDI do mês</p>
					<p class="mt-1 text-2xl font-semibold text-gray-600">
						{pct(month.cdiRate)}
					</p>
				</div>
				<div class="rounded-lg border border-gray-200 bg-white p-4">
					<p class="text-xs text-gray-500">Equivalente a</p>
					<p
						class={`mt-1 text-2xl font-semibold ${cdiClass(month.percentOfCdi)}`}
					>
						{month.percentOfCdi === null
							? '—'
							: `${month.percentOfCdi.toFixed(0)}% do CDI`}
					</p>
				</div>
			</div>

			<p class="text-xs text-gray-500">
				Período de {month.start} a {month.end}. Base de {brl.format(
					month.startValue
				)}
				→ {brl.format(month.endValue)}, com {brl.format(month.netFlow)} de aportes
				líquidos no mês.
			</p>

			{#if month.unpricedCount > 0}
				<div
					class="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
				>
					{month.unpricedCount}
					{month.unpricedCount === 1 ? 'ativo ficou' : 'ativos ficaram'} fora da conta
					por não ter preço público no período — LCA, LCI e CDB não têm cotação publicada,
					e papéis recém-listados não têm histórico. Eles seguem no patrimônio, apenas
					não entram nesta rentabilidade.
				</div>
			{/if}

			<div class="rounded-lg border border-gray-200 bg-white p-4">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
					<h2 class="text-sm font-semibold text-gray-900">Por ativo</h2>
					<label class="flex items-center gap-2 text-xs text-gray-600">
						<input type="checkbox" bind:checked={onlyMovers} class="rounded" />
						Esconder quem não se mexeu
					</label>
				</div>
				<div class="overflow-x-auto">
					<table class="w-full text-left text-sm">
						<thead>
							<tr class="border-b text-xs text-gray-500">
								<th class="py-1 pr-2">Ativo</th>
								<th class="py-1 pr-2 text-right">Início</th>
								<th class="py-1 pr-2 text-right">Fim</th>
								<th class="py-1 pr-2 text-right">Aportes</th>
								<th class="py-1 pr-2 text-right">Rendeu</th>
								<th class="py-1 pr-2 text-right">%</th>
								<th class="py-1 text-right">% do CDI</th>
							</tr>
						</thead>
						<tbody>
							{#each rows as row (row.assetId)}
								<tr class="border-b border-gray-100">
									<td class="py-1 pr-2 font-medium text-gray-900">
										{data.labels[row.assetId]?.label ?? '—'}
										{#if row.unpriced}
											<span class="block text-[10px] text-amber-700"
												>sem preço no período</span
											>
										{/if}
									</td>
									<td class="py-1 pr-2 text-right text-gray-600"
										>{brl.format(row.startValue)}</td
									>
									<td class="py-1 pr-2 text-right text-gray-600"
										>{brl.format(row.endValue)}</td
									>
									<td class="py-1 pr-2 text-right text-gray-500">
										{row.netFlow === 0 ? '—' : brl.format(row.netFlow)}
									</td>
									<td
										class={row.unpriced
											? 'py-1 pr-2 text-right text-gray-400'
											: row.gain >= 0
												? 'py-1 pr-2 text-right font-medium text-emerald-700'
												: 'py-1 pr-2 text-right font-medium text-red-700'}
									>
										{row.unpriced ? '—' : brl.format(row.gain)}
									</td>
									<td class="py-1 pr-2 text-right text-gray-700"
										>{pct(row.returnRate)}</td
									>
									<td class={`py-1 text-right ${cdiClass(row.percentOfCdi)}`}>
										{row.percentOfCdi === null
											? '—'
											: `${row.percentOfCdi.toFixed(0)}%`}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{/if}
</div>
