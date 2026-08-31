<script lang="ts">
	// Two stacked areas: what was put in, and what it is worth. The band
	// between them is the accumulated gain — the thing worth watching, because
	// a rising gross line means little if the applied line rose just as fast.

	type Point = { month: string; applied: number; gross: number };

	let { data, height = 240 }: { data: Point[]; height?: number } = $props();

	const WIDTH = 720;
	const PADDING = { top: 16, right: 12, bottom: 26, left: 64 };

	let plotWidth = $derived(WIDTH - PADDING.left - PADDING.right);
	let plotHeight = $derived(height - PADDING.top - PADDING.bottom);
	// The scale starts at zero so the gap between the lines reads as a real
	// proportion of the patrimony, not as a magnified sliver.
	let max = $derived(Math.max(1, ...data.map((point) => point.gross)) * 1.05);

	let hovered = $state<number | null>(null);

	const x = (index: number) =>
		PADDING.left +
		(data.length <= 1
			? plotWidth / 2
			: (index / (data.length - 1)) * plotWidth);
	const y = (value: number) =>
		PADDING.top + plotHeight - (value / max) * plotHeight;

	function areaPath(pick: (point: Point) => number): string {
		if (data.length === 0) return '';
		const top = data
			.map((point, index) => `${x(index)},${y(pick(point))}`)
			.join(' L ');
		const baseline = PADDING.top + plotHeight;
		return `M ${x(0)},${baseline} L ${top} L ${x(data.length - 1)},${baseline} Z`;
	}

	function linePath(pick: (point: Point) => number): string {
		if (data.length === 0) return '';
		return `M ${data.map((point, index) => `${x(index)},${y(pick(point))}`).join(' L ')}`;
	}

	const brl = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL',
		maximumFractionDigits: 0
	});
	const shortMonth = (month: string) => {
		const [year, monthNumber] = month.split('-').map(Number);
		return new Date(year, monthNumber - 1, 1)
			.toLocaleDateString('pt-BR', { month: 'short' })
			.replace('.', '');
	};

	let point = $derived(hovered === null ? null : data[hovered]);
</script>

{#if data.length < 2}
	<div
		class="flex h-40 items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500"
	>
		Ainda não há meses suficientes com preço para desenhar a evolução.
	</div>
{:else}
	<div class="w-full overflow-x-auto">
		<svg viewBox={`0 0 ${WIDTH} ${height}`} class="w-full min-w-[520px]">
			{#each [0, 0.25, 0.5, 0.75, 1] as tick (tick)}
				<line
					x1={PADDING.left}
					x2={WIDTH - PADDING.right}
					y1={y(max * tick)}
					y2={y(max * tick)}
					stroke="currentColor"
					class="text-gray-100"
				/>
				<text
					x={PADDING.left - 8}
					y={y(max * tick) + 4}
					text-anchor="end"
					class="fill-gray-400 text-[10px]"
				>
					{brl.format(max * tick)}
				</text>
			{/each}

			<path d={areaPath((p) => p.gross)} class="fill-pink-200/70" />
			<path d={areaPath((p) => p.applied)} class="fill-violet-300/80" />
			<path
				d={linePath((p) => p.gross)}
				fill="none"
				stroke="currentColor"
				class="text-pink-500"
				stroke-width="2"
			/>
			<path
				d={linePath((p) => p.applied)}
				fill="none"
				stroke="currentColor"
				class="text-violet-600"
				stroke-width="2"
			/>

			{#each data as entry, index (entry.month)}
				<text
					x={x(index)}
					y={height - 8}
					text-anchor="middle"
					class="fill-gray-500 text-[10px]"
				>
					{shortMonth(entry.month)}
				</text>
				<!-- A wide invisible band per month keeps hovering easy on touch. -->
				<rect
					x={x(index) - plotWidth / (2 * Math.max(1, data.length - 1))}
					y={PADDING.top}
					width={plotWidth / Math.max(1, data.length - 1)}
					height={plotHeight}
					fill="transparent"
					role="presentation"
					onmouseenter={() => (hovered = index)}
					onmouseleave={() => (hovered = null)}
				/>
				{#if hovered === index}
					<line
						x1={x(index)}
						x2={x(index)}
						y1={PADDING.top}
						y2={PADDING.top + plotHeight}
						stroke="currentColor"
						class="text-gray-400"
						stroke-dasharray="3 3"
					/>
					<circle
						cx={x(index)}
						cy={y(entry.gross)}
						r="4"
						class="fill-pink-500"
					/>
					<circle
						cx={x(index)}
						cy={y(entry.applied)}
						r="4"
						class="fill-violet-600"
					/>
				{/if}
			{/each}
		</svg>
	</div>

	<div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
		<div class="flex gap-4">
			<span class="flex items-center gap-1">
				<span class="inline-block h-2 w-2 rounded-full bg-violet-600"></span>
				Valor aplicado
			</span>
			<span class="flex items-center gap-1">
				<span class="inline-block h-2 w-2 rounded-full bg-pink-500"></span>
				Saldo bruto
			</span>
		</div>
		{#if point}
			<span class="text-gray-600">
				{point.month}: aplicado {brl.format(point.applied)} · bruto {brl.format(
					point.gross
				)} · ganho {brl.format(point.gross - point.applied)}
			</span>
		{/if}
	</div>
{/if}
