<script lang="ts">
	import { classColor, classLabel } from '$lib/investments/classes';
	import {
		brl,
		cdiClass,
		dateBr,
		gainClass,
		monthShort,
		signedBrl,
		signedPct
	} from '$lib/investments/format';

	// Side panel with everything about one holding: current position, cost,
	// a year of prices, month-by-month return and the latest events. Fetched
	// on open, so the overview page stays light.

	interface AssetDetail {
		asset: {
			id: string;
			label: string;
			name: string;
			assetClass: string;
		};
		quantity: number;
		price: number | null;
		priceDate: string | null;
		value: number;
		averageCost: number | null;
		totalCost: number | null;
		prices: { date: string; price: number }[];
		history: {
			month: string;
			gain: number;
			returnRate: number | null;
			percentOfCdi: number | null;
			unpriced: boolean;
		}[];
		events: {
			date: string;
			type: string;
			direction: string;
			quantity: number | null;
			total: number | null;
		}[];
	}

	let { assetId, onClose }: { assetId: string | null; onClose: () => void } =
		$props();

	let detail = $state<AssetDetail | null>(null);
	let loading = $state(false);
	let failed = $state(false);

	$effect(() => {
		const id = assetId;
		detail = null;
		failed = false;
		if (!id) return;
		loading = true;
		const controller = new AbortController();
		fetch(`/app/investments/api/asset/${id}`, { signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) throw new Error(String(response.status));
				detail = (await response.json()) as AssetDetail;
			})
			.catch((error) => {
				if ((error as Error).name !== 'AbortError') failed = true;
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});

	// Unrealized result against the average cost, when a cost exists.
	let unrealized = $derived(
		detail && detail.totalCost !== null && detail.totalCost > 0
			? detail.value - detail.totalCost
			: null
	);
	let unrealizedRate = $derived(
		detail && unrealized !== null && detail.totalCost
			? unrealized / detail.totalCost
			: null
	);

	// A plain polyline scaled to the box; enough to show the shape of a year.
	const SPARK_W = 320;
	const SPARK_H = 72;
	let spark = $derived.by(() => {
		const points = detail?.prices ?? [];
		if (points.length < 2) return null;
		const values = points.map((p) => p.price);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min || 1;
		const step = SPARK_W / (points.length - 1);
		const path = points
			.map(
				(p, i) =>
					`${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(
						SPARK_H -
						4 -
						((p.price - min) / span) * (SPARK_H - 8)
					).toFixed(1)}`
			)
			.join(' ');
		const first = points[0];
		const last = points[points.length - 1];
		return {
			path,
			min,
			max,
			from: first.date,
			to: last.date,
			change: first.price > 0 ? last.price / first.price - 1 : null
		};
	});

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if assetId}
	<!-- Backdrop -->
	<button
		type="button"
		class="fixed inset-0 z-30 bg-gray-900/30"
		aria-label="Fechar detalhe do ativo"
		onclick={onClose}
	></button>

	<div
		class="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl"
		role="dialog"
		aria-modal="true"
		aria-labelledby="asset-detail-title"
	>
		<div
			class="flex items-start justify-between gap-3 border-b border-gray-200 p-4"
		>
			<div class="min-w-0">
				{#if detail}
					<p class="flex items-center gap-1.5 text-xs text-gray-500">
						<span
							class="inline-block h-2 w-2 rounded-full"
							style={`background:${classColor(detail.asset.assetClass)}`}
						></span>
						{classLabel(detail.asset.assetClass)}
					</p>
					<h2
						id="asset-detail-title"
						class="truncate text-lg font-semibold text-gray-900"
					>
						{detail.asset.label}
					</h2>
					{#if detail.asset.label !== detail.asset.name}
						<p class="truncate text-xs text-gray-500">{detail.asset.name}</p>
					{/if}
				{:else}
					<h2
						id="asset-detail-title"
						class="text-lg font-semibold text-gray-900"
					>
						{loading ? 'Carregando…' : 'Ativo'}
					</h2>
				{/if}
			</div>
			<button
				type="button"
				class="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
				aria-label="Fechar"
				onclick={onClose}
			>
				✕
			</button>
		</div>

		{#if failed}
			<p class="p-4 text-sm text-red-700">
				Não foi possível carregar este ativo.
			</p>
		{:else if detail}
			<div class="space-y-5 p-4">
				<div class="grid grid-cols-2 gap-3">
					<div class="rounded-lg border border-gray-200 p-3">
						<p class="text-xs text-gray-500">Valor atual</p>
						<p class="text-lg font-semibold text-gray-900">
							{brl(detail.value)}
						</p>
						<p class="text-[11px] text-gray-500">
							{detail.quantity.toLocaleString('pt-BR')} ×
							{detail.price === null ? '—' : brl(detail.price)}
						</p>
					</div>
					<div class="rounded-lg border border-gray-200 p-3">
						<p class="text-xs text-gray-500">Resultado sobre o custo</p>
						{#if unrealized !== null}
							<p class={`text-lg font-semibold ${gainClass(unrealized)}`}>
								{signedBrl(unrealized)}
							</p>
							<p class={`text-[11px] ${gainClass(unrealized)}`}>
								{signedPct(unrealizedRate)} · preço médio
								{detail.averageCost === null ? '—' : brl(detail.averageCost)}
							</p>
						{:else}
							<p class="text-lg font-semibold text-gray-400">—</p>
							<p class="text-[11px] text-gray-500">
								sem custo de entrada registrado
							</p>
						{/if}
					</div>
				</div>

				<section>
					<div class="flex items-baseline justify-between">
						<h3 class="text-sm font-semibold text-gray-900">
							Preço nos últimos 12 meses
						</h3>
						{#if spark}
							<span class={`text-xs ${gainClass(spark.change)}`}
								>{signedPct(spark.change)}</span
							>
						{/if}
					</div>
					{#if spark}
						<svg
							viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
							class="mt-2 h-20 w-full"
							preserveAspectRatio="none"
							role="img"
							aria-label={`Preço de ${brl(spark.min)} a ${brl(spark.max)} entre ${dateBr(spark.from)} e ${dateBr(spark.to)}`}
						>
							<path
								d={spark.path}
								fill="none"
								stroke={classColor(detail.asset.assetClass)}
								stroke-width="2"
								vector-effect="non-scaling-stroke"
							/>
						</svg>
						<p class="flex justify-between text-[11px] text-gray-500">
							<span>{dateBr(spark.from)}</span>
							<span>mín {brl(spark.min)} · máx {brl(spark.max)}</span>
							<span>{dateBr(spark.to)}</span>
						</p>
					{:else}
						<p class="mt-2 text-xs text-gray-500">
							Sem histórico de preço suficiente. Papéis bancários (LCA, LCI,
							CDB) não têm cotação pública.
						</p>
					{/if}
				</section>

				<section>
					<h3 class="text-sm font-semibold text-gray-900">
						Rendimento por mês
					</h3>
					{#if detail.history.length === 0}
						<p class="mt-2 text-xs text-gray-500">Sem meses medidos.</p>
					{:else}
						<table class="mt-2 w-full text-xs">
							<thead>
								<tr class="border-b text-gray-500">
									<th class="py-1 text-left font-normal">Mês</th>
									<th class="py-1 text-right font-normal">Rendeu</th>
									<th class="py-1 text-right font-normal">%</th>
									<th class="py-1 text-right font-normal">% do CDI</th>
								</tr>
							</thead>
							<tbody>
								{#each detail.history as row (row.month)}
									<tr class="border-b border-gray-100">
										<td class="py-1 text-gray-700">{monthShort(row.month)}</td>
										{#if row.unpriced}
											<td colspan="3" class="py-1 text-right text-amber-700"
												>sem preço no período</td
											>
										{:else}
											<td
												class={`py-1 text-right font-medium ${gainClass(row.gain)}`}
												>{signedBrl(row.gain)}</td
											>
											<td class="py-1 text-right text-gray-700"
												>{signedPct(row.returnRate)}</td
											>
											<td
												class={`py-1 text-right ${cdiClass(row.percentOfCdi)}`}
											>
												{row.percentOfCdi === null
													? '—'
													: `${row.percentOfCdi.toFixed(0)}%`}
											</td>
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</section>

				<section>
					<h3 class="text-sm font-semibold text-gray-900">
						Últimas movimentações
					</h3>
					{#if detail.events.length === 0}
						<p class="mt-2 text-xs text-gray-500">
							Nenhuma movimentação registrada.
						</p>
					{:else}
						<ul class="mt-2 divide-y divide-gray-100 text-xs">
							{#each detail.events as event (`${event.date}-${event.type}-${event.total}`)}
								<li class="flex items-center justify-between gap-2 py-1.5">
									<div class="min-w-0">
										<p class="truncate text-gray-900">{event.type}</p>
										<p class="text-gray-500">
											{dateBr(event.date)}{event.quantity
												? ` · ${event.quantity.toLocaleString('pt-BR')} un.`
												: ''}
										</p>
									</div>
									<span
										class={event.direction === 'credit'
											? 'text-emerald-700'
											: 'text-gray-700'}
									>
										{event.total === null ? '—' : brl(event.total)}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<p class="text-[11px] text-gray-400">
					Cotação de {dateBr(detail.priceDate)}. Valores entre reconciliações
					com a B3 são calculados.
				</p>
			</div>
		{:else}
			<div class="space-y-3 p-4" aria-busy="true">
				<div class="h-16 animate-pulse rounded-lg bg-gray-100"></div>
				<div class="h-20 animate-pulse rounded-lg bg-gray-100"></div>
				<div class="h-32 animate-pulse rounded-lg bg-gray-100"></div>
			</div>
		{/if}
	</div>
{/if}
