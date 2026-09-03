<script lang="ts">
	import { resolve } from '$app/paths';
	import ReturnGauge from '$lib/components/charts/ReturnGauge.svelte';
	import AppliedVsGrossChart from '$lib/components/charts/AppliedVsGrossChart.svelte';
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

	// The money-weighted rate since the first contribution, which answers a
	// different question from the month picker above it.
	let perf = $derived(data.performance.sinceInception);
	let incomeMax = $derived(Math.max(1, ...data.income.map((i) => i.recurring)));
	let maturityMonths = $derived(data.income.filter((i) => i.maturity > 0));

	// Two different questions about the same month: what moved the most, and
	// what moved the patrimony the most. A 12% jump on a small holding wins the
	// first and barely registers in the second.
	const TOP = 6;
	let measured = $derived(rows.filter((row) => !row.unpriced));
	let byVariation = $derived(
		[...measured]
			.filter((row) => row.returnRate !== null)
			.sort((a, b) => Math.abs(b.returnRate ?? 0) - Math.abs(a.returnRate ?? 0))
			.slice(0, TOP)
	);
	let byImpact = $derived(
		[...measured]
			.sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain))
			.slice(0, TOP)
	);
	let maxVariation = $derived(
		Math.max(0.0001, ...byVariation.map((row) => Math.abs(row.returnRate ?? 0)))
	);
	let maxImpact = $derived(
		Math.max(1, ...byImpact.map((row) => Math.abs(row.gain)))
	);
	const barWidth = (value: number | null, max: number) =>
		Math.min(100, (Math.abs(value ?? 0) / max) * 100);

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
			<h2 class="text-sm font-semibold text-gray-900">Rendimento mensal</h2>
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
			<div class="grid gap-4 lg:grid-cols-[260px_1fr]">
				<div
					class="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-4"
				>
					<ReturnGauge
						portfolio={month.returnRate}
						cdi={month.cdiRate}
						label={monthName(month.month)}
						centerValue={brl.format(month.endValue)}
						centerCaption={`ganho de ${brl.format(month.gain)}`}
						percentOfCdi={month.percentOfCdi}
					/>
				</div>
				<div class="rounded-lg border border-gray-200 bg-white p-4">
					<h2 class="text-sm font-semibold text-gray-900">
						Valor aplicado × saldo bruto
					</h2>
					<p class="mt-1 mb-2 text-xs text-gray-500">
						A faixa entre as linhas é o ganho acumulado.
					</p>
					<AppliedVsGrossChart data={data.applied.points} />
					{#if data.applied.excludedCount > 0}
						<p class="mt-2 text-xs text-amber-700">
							{data.applied.excludedCount}
							{data.applied.excludedCount === 1 ? 'ativo fica' : 'ativos ficam'} fora
							desta curva ({brl.format(data.applied.excludedValue)}): não têm
							preço em todo o período, e entrariam como um degrau no mês em que
							aparecem.
						</p>
					{/if}
				</div>
			</div>

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

			{#if month.cdiThrough && month.cdiThrough < month.end}
				<div
					class="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
				>
					O Banco Central publica o CDI com atraso: a série vai só até {month.cdiThrough},
					não até {month.end}. O CDI do período está incompleto, então o "% do
					CDI" acima está mais alto do que ficará quando o mês fechar.
				</div>
			{/if}

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

			<div class="grid gap-4 lg:grid-cols-2">
				<div class="rounded-lg border border-gray-200 bg-white p-4">
					<h2 class="text-sm font-semibold text-gray-900">Quem mais variou</h2>
					<p class="mt-1 text-xs text-gray-500">
						Movimento percentual, independente do tamanho da posição.
					</p>
					<div class="mt-3 space-y-1">
						{#each byVariation as row (row.assetId)}
							<div class="flex items-center gap-2 text-xs">
								<span class="w-28 truncate text-gray-700"
									>{data.labels[row.assetId]?.label ?? '—'}</span
								>
								<div class="flex flex-1 items-center">
									<div class="flex h-4 w-1/2 justify-end">
										{#if (row.returnRate ?? 0) < 0}
											<div
												class="h-4 rounded-l bg-red-400"
												style={`width: ${barWidth(row.returnRate, maxVariation)}%`}
											></div>
										{/if}
									</div>
									<div class="h-4 w-px bg-gray-300"></div>
									<div class="flex h-4 w-1/2">
										{#if (row.returnRate ?? 0) > 0}
											<div
												class="h-4 rounded-r bg-emerald-500"
												style={`width: ${barWidth(row.returnRate, maxVariation)}%`}
											></div>
										{/if}
									</div>
								</div>
								<span
									class={`w-16 text-right ${(row.returnRate ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
									>{pct(row.returnRate)}</span
								>
							</div>
						{/each}
					</div>
				</div>

				<div class="rounded-lg border border-gray-200 bg-white p-4">
					<h2 class="text-sm font-semibold text-gray-900">
						Quem mais pesou no patrimônio
					</h2>
					<p class="mt-1 text-xs text-gray-500">
						Impacto em reais — o que realmente moveu o total.
					</p>
					<div class="mt-3 space-y-1">
						{#each byImpact as row (row.assetId)}
							<div class="flex items-center gap-2 text-xs">
								<span class="w-28 truncate text-gray-700"
									>{data.labels[row.assetId]?.label ?? '—'}</span
								>
								<div class="flex flex-1 items-center">
									<div class="flex h-4 w-1/2 justify-end">
										{#if row.gain < 0}
											<div
												class="h-4 rounded-l bg-red-400"
												style={`width: ${barWidth(row.gain, maxImpact)}%`}
											></div>
										{/if}
									</div>
									<div class="h-4 w-px bg-gray-300"></div>
									<div class="flex h-4 w-1/2">
										{#if row.gain > 0}
											<div
												class="h-4 rounded-r bg-emerald-500"
												style={`width: ${barWidth(row.gain, maxImpact)}%`}
											></div>
										{/if}
									</div>
								</div>
								<span
									class={`w-24 text-right ${row.gain >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
									>{brl.format(row.gain)}</span
								>
							</div>
						{/each}
					</div>
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
