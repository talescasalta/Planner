<script lang="ts">
	// Two arcs on one ring: the portfolio's month against the CDI's. Their
	// lengths are proportional to the same scale, so the comparison is the
	// shape itself — no need to read the numbers to see who won.
	//
	// A negative month draws inward from the top in the opposite direction,
	// which keeps "below zero" visually distinct from "small but positive".

	let {
		portfolio,
		cdi,
		label,
		centerValue,
		centerCaption,
		percentOfCdi
	}: {
		portfolio: number | null;
		cdi: number;
		label: string;
		centerValue: string;
		centerCaption: string;
		percentOfCdi: number | null;
	} = $props();

	const SIZE = 240;
	const CENTER = SIZE / 2;
	const OUTER = 100;
	const INNER = 86;

	// The ring is scaled to whichever rate is larger, so the winner always
	// fills it and the loser is read against it.
	let scale = $derived(
		Math.max(Math.abs(portfolio ?? 0), Math.abs(cdi), 0.0001) * 1.15
	);

	function arc(rate: number, radius: number): string {
		const fraction = Math.min(1, Math.abs(rate) / scale);
		if (fraction < 0.001) return '';
		// Start at the top and sweep clockwise for gains, anticlockwise for losses.
		const sweep = fraction * 2 * Math.PI * (rate < 0 ? -1 : 1);
		const endX = CENTER + radius * Math.sin(sweep);
		const endY = CENTER - radius * Math.cos(sweep);
		const largeArc = Math.abs(sweep) > Math.PI ? 1 : 0;
		const direction = rate < 0 ? 0 : 1;
		return `M ${CENTER} ${CENTER - radius} A ${radius} ${radius} 0 ${largeArc} ${direction} ${endX} ${endY}`;
	}

	let portfolioArc = $derived(portfolio === null ? '' : arc(portfolio, OUTER));
	let cdiArc = $derived(arc(cdi, INNER));
	let winning = $derived(percentOfCdi !== null && percentOfCdi >= 100);
</script>

<div class="flex flex-col items-center">
	<svg
		viewBox={`0 0 ${SIZE} ${SIZE}`}
		class="h-56 w-56"
		role="img"
		aria-label={label}
	>
		<circle
			cx={CENTER}
			cy={CENTER}
			r={OUTER}
			fill="none"
			stroke="currentColor"
			class="text-gray-100"
			stroke-width="12"
		/>
		<circle
			cx={CENTER}
			cy={CENTER}
			r={INNER}
			fill="none"
			stroke="currentColor"
			class="text-gray-50"
			stroke-width="10"
		/>
		{#if cdiArc}
			<path
				d={cdiArc}
				fill="none"
				stroke="currentColor"
				class="text-violet-500"
				stroke-width="10"
				stroke-linecap="round"
			/>
		{/if}
		{#if portfolioArc}
			<path
				d={portfolioArc}
				fill="none"
				stroke="currentColor"
				class={portfolio !== null && portfolio < 0
					? 'text-red-500'
					: 'text-cyan-500'}
				stroke-width="12"
				stroke-linecap="round"
			/>
		{/if}
		<text
			x={CENTER}
			y={CENTER - 22}
			text-anchor="middle"
			class="fill-gray-500 text-[10px] uppercase"
		>
			{label}
		</text>
		<text
			x={CENTER}
			y={CENTER + 4}
			text-anchor="middle"
			class="fill-gray-900 text-[19px] font-semibold"
		>
			{centerValue}
		</text>
		<text
			x={CENTER}
			y={CENTER + 26}
			text-anchor="middle"
			class={winning
				? 'fill-emerald-600 text-[12px]'
				: 'fill-amber-600 text-[12px]'}
		>
			{percentOfCdi === null ? '' : `${percentOfCdi.toFixed(0)}% do CDI`}
		</text>
		<text
			x={CENTER}
			y={CENTER + 44}
			text-anchor="middle"
			class="fill-gray-500 text-[10px]"
		>
			{centerCaption}
		</text>
	</svg>
	<div class="mt-1 flex gap-4 text-xs">
		<span class="flex items-center gap-1">
			<span
				class={portfolio !== null && portfolio < 0
					? 'inline-block h-2 w-2 rounded-full bg-red-500'
					: 'inline-block h-2 w-2 rounded-full bg-cyan-500'}
			></span>
			Carteira {portfolio === null ? '—' : `${(portfolio * 100).toFixed(2)}%`}
		</span>
		<span class="flex items-center gap-1">
			<span class="inline-block h-2 w-2 rounded-full bg-violet-500"></span>
			CDI {(cdi * 100).toFixed(2)}%
		</span>
	</div>
</div>
