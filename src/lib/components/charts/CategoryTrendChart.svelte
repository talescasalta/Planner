<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';

	type Series = { id: string; name: string };
	type Point = { month: string; total: number; values: Record<string, number> };

	let {
		series,
		points,
		height = 240
	}: { series: Series[]; points: Point[]; height?: number } = $props();

	// Validated categorical palette (dataviz reference, light mode). Neutral
	// gray is reserved for "Outras"/"Sem categoria" so it never reads as a
	// real category; color follows the entity, assigned by series order.
	const SLOT_COLORS = [
		'#2a78d6',
		'#1baf7a',
		'#eda100',
		'#008300',
		'#4a3aa7',
		'#e34948'
	];
	const NEUTRAL_COLOR = '#898781';
	const NEUTRAL_IDS = new Set(['__others__', '__uncategorized__']);

	let colorById = $derived.by(() => {
		const map = new SvelteMap<string, string>();
		let slot = 0;
		for (const s of series) {
			if (NEUTRAL_IDS.has(s.id)) map.set(s.id, NEUTRAL_COLOR);
			else map.set(s.id, SLOT_COLORS[slot++ % SLOT_COLORS.length]);
		}
		return map;
	});

	let maxTotal = $derived(Math.max(1, ...points.map((p) => p.total)));

	function fmtCompact(value: number) {
		if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
		return String(Math.round(value));
	}

	function fmtFull(value: number) {
		return value.toLocaleString('pt-BR', {
			style: 'currency',
			currency: 'BRL'
		});
	}

	function shortMonth(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return month;
		return new Date(year, monthNumber - 1, 1)
			.toLocaleDateString('pt-BR', { month: 'short' })
			.replace('.', '');
	}

	function segments(point: Point) {
		return series
			.map((s) => ({ ...s, value: point.values[s.id] ?? 0 }))
			.filter((s) => s.value > 0);
	}
</script>

{#if points.length === 0}
	<div
		class="flex h-48 items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500"
	>
		Sem dados suficientes.
	</div>
{:else}
	<div class="flex items-end gap-1.5 sm:gap-2" style={`height: ${height}px`}>
		{#each points as point (point.month)}
			<div class="flex h-full min-w-0 flex-1 flex-col justify-end">
				<p class="mb-1 text-center text-[10px] font-medium text-gray-500">
					{point.total > 0 ? fmtCompact(point.total) : ''}
				</p>
				<div
					class="flex flex-col-reverse gap-[2px] overflow-hidden rounded-t"
					style={`height: ${(point.total / maxTotal) * (height - 44)}px`}
				>
					{#each segments(point) as seg (seg.id)}
						<div
							class="w-full transition-opacity hover:opacity-80"
							style={`flex: ${seg.value} 0 0; background-color: ${colorById.get(seg.id)}`}
							title={`${seg.name} — ${fmtFull(seg.value)} (${shortMonth(point.month)})`}
						></div>
					{/each}
				</div>
				<p
					class="mt-1 truncate text-center text-[11px] capitalize text-gray-600"
				>
					{shortMonth(point.month)}
				</p>
			</div>
		{/each}
	</div>

	<div
		class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600"
	>
		{#each series as s (s.id)}
			<span class="inline-flex items-center gap-1.5">
				<span
					class="h-2 w-3 rounded-sm"
					style={`background-color: ${colorById.get(s.id)}`}
				></span>
				{s.name}
			</span>
		{/each}
	</div>
{/if}
