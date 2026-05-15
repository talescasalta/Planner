<script lang="ts">
	import { scaleBand } from 'd3-scale';
	import { Axis, Chart, Spline, Svg } from 'layerchart';

	type Point = { month: string; expenses: number; credits: number; balance: number };

	let { data, currency = 'BRL' }: { data: Point[]; currency?: string } = $props();

	function fmtCompact(value: number) {
		const abs = Math.abs(value);
		if (abs >= 1000) return `R$ ${(value / 1000).toFixed(1)}k`;
		return value.toLocaleString('pt-BR', { style: 'currency', currency, maximumFractionDigits: 0 });
	}

	function fmtFull(value: number) {
		return value.toLocaleString('pt-BR', { style: 'currency', currency });
	}

	function shortMonth(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return month;
		return new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
	}

	let yMax = $derived(Math.max(0, ...data.flatMap((d) => [d.expenses, d.credits])));
</script>

{#if data.length === 0}
	<div class="flex h-56 items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
		Sem dados de evolução.
	</div>
{:else}
	<div class="h-64 w-full">
		<Chart
			{data}
			x="month"
			xScale={scaleBand().padding(0.1)}
			y={['expenses', 'credits']}
			yDomain={[0, yMax]}
			yNice
			padding={{ top: 16, right: 16, bottom: 28, left: 56 }}
		>
			<Svg>
				<Axis placement="left" ticks={4} format={(v: number) => fmtCompact(v)} grid rule={false} classes={{ tickLabel: 'text-[11px] fill-gray-500' }} />
				<Axis placement="bottom" format={(m: string) => shortMonth(m)} rule classes={{ tickLabel: 'text-[11px] fill-gray-600 capitalize' }} />
				<Spline y="credits" class="stroke-emerald-500" stroke-width="2" />
				<Spline y="expenses" class="stroke-rose-500" stroke-width="2" />
			</Svg>
		</Chart>
	</div>

	<div class="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-600">
		<span class="inline-flex items-center gap-1.5">
			<span class="h-2 w-3 rounded-sm bg-rose-500"></span>
			Despesas
		</span>
		<span class="inline-flex items-center gap-1.5">
			<span class="h-2 w-3 rounded-sm bg-emerald-500"></span>
			Receitas
		</span>
		<span class="ml-auto text-gray-500">
			Último: {fmtFull(data[data.length - 1]?.balance ?? 0)} (saldo)
		</span>
	</div>
{/if}
