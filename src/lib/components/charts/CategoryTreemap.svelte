<script lang="ts">
	import { hierarchy } from 'd3-hierarchy';
	import { Chart, Svg, Treemap } from 'layerchart';

	type Leaf = { id: string; name: string; total: number };
	type Group = { id: string; name: string; total: number; children: Leaf[] };

	let {
		nodes,
		currency = 'BRL',
		height = 420
	}: { nodes: Group[]; currency?: string; height?: number } = $props();

	// Curated 10-color categorical palette tuned for light backgrounds.
	const PALETTE = [
		'#6366f1', // indigo
		'#0ea5e9', // sky
		'#10b981', // emerald
		'#f59e0b', // amber
		'#ef4444', // red
		'#8b5cf6', // violet
		'#14b8a6', // teal
		'#f97316', // orange
		'#ec4899', // pink
		'#64748b' // slate
	];

	type TreeDatum = { name: string; total?: number; children?: TreeDatum[] };
	let root = $derived(
		hierarchy<TreeDatum>({
			name: 'root',
			children: nodes.map((node) => ({
				name: node.name,
				children: node.children.length
					? node.children.map((c) => ({ name: c.name, total: c.total }))
					: [{ name: node.name, total: node.total }]
			}))
		})
			.sum((d) => d.total ?? 0)
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
	);

	let colorByCategory = $derived.by(() => {
		const map = new Map<string, string>();
		nodes.forEach((node, idx) => {
			map.set(node.name, PALETTE[idx % PALETTE.length]);
		});
		return map;
	});

	let hovered = $state<{
		x: number;
		y: number;
		categoryName: string;
		leafName: string;
		value: number;
		share: number;
	} | null>(null);

	const totalValue = $derived(nodes.reduce((sum, n) => sum + n.total, 0));

	function fmt(value: number) {
		return value.toLocaleString('pt-BR', { style: 'currency', currency });
	}

	function categoryNameFor(node: { parent: { data: { name: string } } | null; data: { name: string } }): string {
		// walk up to depth=1 (top-level category under root)
		let current: any = node;
		while (current?.parent && current.parent.depth > 0) current = current.parent;
		return current?.data?.name ?? node.data.name;
	}

	function handleEnter(event: MouseEvent, leaf: any) {
		const target = event.currentTarget as SVGElement;
		const svgRect = target.ownerSVGElement?.getBoundingClientRect();
		if (!svgRect) return;
		const value = leaf.value ?? 0;
		hovered = {
			x: event.clientX - svgRect.left,
			y: event.clientY - svgRect.top,
			categoryName: categoryNameFor(leaf),
			leafName: leaf.data.name,
			value,
			share: totalValue > 0 ? (value / totalValue) * 100 : 0
		};
	}

	function handleLeave() {
		hovered = null;
	}
</script>

{#if nodes.length === 0 || totalValue === 0}
	<div class="flex h-{height}px items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
		Sem despesas para os filtros atuais.
	</div>
{:else}
	<div class="relative w-full" style={`height:${height}px`}>
		<Chart data={root}>
			<Svg>
				<Treemap let:nodes={treemapNodes} paddingInner={2} paddingOuter={4} paddingTop={18}>
					{#each treemapNodes as node (node.data.name + node.depth + node.x0)}
					{#if node.depth === 0}
						<!-- skip root -->
					{:else if node.depth === 1}
						<!-- category header rect -->
						<rect
							x={node.x0}
							y={node.y0}
							width={Math.max(0, node.x1 - node.x0)}
							height={Math.max(0, node.y1 - node.y0)}
							fill={colorByCategory.get(node.data.name) ?? '#94a3b8'}
							fill-opacity="0.12"
							stroke={colorByCategory.get(node.data.name) ?? '#94a3b8'}
							stroke-opacity="0.4"
							stroke-width="1"
							rx="6"
						/>
						{#if node.x1 - node.x0 > 80 && node.y1 - node.y0 > 22}
							<text
								x={node.x0 + 8}
								y={node.y0 + 13}
								class="pointer-events-none select-none text-[11px] font-semibold uppercase tracking-wide"
								fill={colorByCategory.get(node.data.name) ?? '#475569'}
								fill-opacity="0.9"
							>
								{node.data.name}
							</text>
						{/if}
					{:else}
						{@const color = colorByCategory.get(categoryNameFor(node)) ?? '#6366f1'}
						{@const w = Math.max(0, node.x1 - node.x0)}
						{@const h = Math.max(0, node.y1 - node.y0)}
						<g
							role="presentation"
							onmouseenter={(e) => handleEnter(e, node)}
							onmousemove={(e) => handleEnter(e, node)}
							onmouseleave={handleLeave}
						>
							<rect
								x={node.x0}
								y={node.y0}
								width={w}
								height={h}
								fill={color}
								fill-opacity={hovered && hovered.leafName === node.data.name && hovered.categoryName === categoryNameFor(node) ? 0.95 : 0.78}
								stroke="white"
								stroke-width="1"
								rx="3"
							/>
							{#if w > 60 && h > 30}
								<text
									x={node.x0 + 6}
									y={node.y0 + 16}
									class="pointer-events-none select-none text-[11px] font-medium"
									fill="white"
								>
									{node.data.name}
								</text>
							{/if}
							{#if w > 60 && h > 46}
								<text
									x={node.x0 + 6}
									y={node.y0 + 30}
									class="pointer-events-none select-none text-[10px]"
									fill="white"
									fill-opacity="0.85"
								>
									{fmt(node.value ?? 0)}
								</text>
							{/if}
						</g>
					{/if}
				{/each}
			</Treemap>
		</Svg>
	</Chart>

		{#if hovered}
			<div
				class="pointer-events-none absolute z-10 max-w-xs rounded-md bg-gray-900/95 px-3 py-2 text-xs text-white shadow-lg"
				style={`left:${Math.min(hovered.x + 12, 320)}px; top:${Math.max(hovered.y - 12, 0)}px`}
			>
				<p class="text-[10px] uppercase tracking-wide text-gray-300">{hovered.categoryName}</p>
				<p class="mt-0.5 font-medium">{hovered.leafName}</p>
				<p class="mt-1 text-sm font-semibold">{fmt(hovered.value)}</p>
				<p class="text-[11px] text-gray-300">{hovered.share.toFixed(1)}% do total</p>
			</div>
		{/if}
	</div>
{/if}
