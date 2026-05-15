<script lang="ts">
	import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';

	type Leaf = { id: string; name: string; total: number };
	type Group = { id: string; name: string; total: number; children: Leaf[] };
	export type TreemapSelection = {
		categoryId: string;
		subcategoryId: string;
		categoryName: string;
		subcategoryName: string;
	};

	let {
		nodes,
		currency = 'BRL',
		height = 420,
		selected = null,
		onSelect
	}: {
		nodes: Group[];
		currency?: string;
		height?: number;
		selected?: TreemapSelection | null;
		onSelect?: (sel: TreemapSelection | null) => void;
	} = $props();

	const PALETTE = [
		'#6366f1',
		'#0ea5e9',
		'#10b981',
		'#f59e0b',
		'#ef4444',
		'#8b5cf6',
		'#14b8a6',
		'#f97316',
		'#ec4899',
		'#64748b'
	];

	let containerWidth = $state(0);
	const PADDING_TOP = 22;
	const PADDING_INNER = 2;

	type TreeDatum = { id?: string; name: string; total?: number; children?: TreeDatum[] };

	let layout = $derived.by(() => {
		const w = containerWidth || 800;
		const h = height;
		if (w <= 0 || h <= 0 || nodes.length === 0) return [];

		const root = hierarchy<TreeDatum>({
			name: 'root',
			children: nodes.map((node) => ({
				id: node.id,
				name: node.name,
				children: node.children.length
					? node.children.map((c) => ({ id: c.id, name: c.name, total: c.total }))
					: [{ id: `${node.id}-self`, name: node.name, total: node.total }]
			}))
		})
			.sum((d) => d.total ?? 0)
			.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

		const tm = treemap<TreeDatum>()
			.size([w, h])
			.tile(treemapSquarify)
			.paddingOuter(0)
			.paddingTop(PADDING_TOP)
			.paddingInner(PADDING_INNER);

		return tm(root).descendants();
	});

	let colorByCategory = $derived.by(() => {
		const map = new Map<string, string>();
		nodes.forEach((node, idx) => {
			map.set(node.id, PALETTE[idx % PALETTE.length]);
		});
		return map;
	});

	let totalValue = $derived(nodes.reduce((sum, n) => sum + n.total, 0));

	let hovered = $state<{
		x: number;
		y: number;
		categoryName: string;
		leafName: string;
		value: number;
		share: number;
	} | null>(null);

	function fmt(value: number) {
		return value.toLocaleString('pt-BR', { style: 'currency', currency });
	}

	function categoryNodeFor(node: any): any {
		let current = node;
		while (current?.parent && current.parent.depth > 0) current = current.parent;
		return current;
	}

	function handleEnter(event: MouseEvent, leaf: any) {
		const svg = (event.currentTarget as SVGElement).ownerSVGElement;
		if (!svg) return;
		const rect = svg.getBoundingClientRect();
		const cat = categoryNodeFor(leaf);
		hovered = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
			categoryName: cat?.data?.name ?? '',
			leafName: leaf.data.name,
			value: leaf.value ?? 0,
			share: totalValue > 0 ? ((leaf.value ?? 0) / totalValue) * 100 : 0
		};
	}

	function handleLeave() {
		hovered = null;
	}

	function handleClick(leaf: any) {
		if (!onSelect) return;
		const cat = categoryNodeFor(leaf);
		const sel: TreemapSelection = {
			categoryId: cat?.data?.id ?? '',
			subcategoryId: leaf?.data?.id ?? '',
			categoryName: cat?.data?.name ?? '',
			subcategoryName: leaf?.data?.name ?? ''
		};
		const same =
			selected &&
			selected.categoryId === sel.categoryId &&
			selected.subcategoryId === sel.subcategoryId;
		onSelect(same ? null : sel);
	}

	function isSelected(leaf: any): boolean {
		if (!selected) return false;
		const cat = categoryNodeFor(leaf);
		return (
			selected.categoryId === (cat?.data?.id ?? '') &&
			selected.subcategoryId === (leaf?.data?.id ?? '')
		);
	}
</script>

{#if nodes.length === 0 || totalValue === 0}
	<div class="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500" style={`height:${height}px`}>
		Sem despesas para os filtros atuais.
	</div>
{:else}
	<div class="relative w-full" style={`height:${height}px`} bind:clientWidth={containerWidth}>
		{#if containerWidth > 0}
			<svg width={containerWidth} height={height} class="block">
				{#each layout as node (`${node.data.id ?? node.data.name}-${node.depth}`)}
					{#if node.depth === 0}
						<!-- root: skip -->
					{:else if node.depth === 1}
						{@const color = colorByCategory.get(node.data.id ?? '') ?? '#94a3b8'}
						{@const w = Math.max(0, (node.x1 ?? 0) - (node.x0 ?? 0))}
						{@const h = Math.max(0, (node.y1 ?? 0) - (node.y0 ?? 0))}
						<g>
							<rect
								x={node.x0}
								y={node.y0}
								width={w}
								height={h}
								fill={color}
								fill-opacity="0.12"
								stroke={color}
								stroke-opacity="0.5"
								stroke-width="1"
								rx="5"
							/>
							{#if w > 60 && h > PADDING_TOP}
								<text
									x={(node.x0 ?? 0) + 8}
									y={(node.y0 ?? 0) + 15}
									class="pointer-events-none select-none"
									font-size="11"
									font-weight="600"
									letter-spacing="0.04em"
									fill={color}
									fill-opacity="0.95"
								>
									{node.data.name.toUpperCase()}
								</text>
							{/if}
						</g>
					{:else}
						{@const cat = categoryNodeFor(node)}
						{@const color = colorByCategory.get(cat?.data?.id ?? '') ?? '#6366f1'}
						{@const w = Math.max(0, (node.x1 ?? 0) - (node.x0 ?? 0))}
						{@const h = Math.max(0, (node.y1 ?? 0) - (node.y0 ?? 0))}
						{@const sel = isSelected(node)}
						<g
							role="button"
							tabindex="0"
							class={onSelect ? 'cursor-pointer' : ''}
							onmouseenter={(e) => handleEnter(e, node)}
							onmousemove={(e) => handleEnter(e, node)}
							onmouseleave={handleLeave}
							onclick={() => handleClick(node)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									handleClick(node);
								}
							}}
						>
							<rect
								x={node.x0}
								y={node.y0}
								width={w}
								height={h}
								fill={color}
								fill-opacity={sel ? 0.95 : 0.82}
								stroke={sel ? '#0f172a' : 'white'}
								stroke-width={sel ? 2 : 1}
								rx="2"
							/>
							{#if w > 60 && h > 28}
								<text
									x={(node.x0 ?? 0) + 6}
									y={(node.y0 ?? 0) + 16}
									class="pointer-events-none select-none"
									font-size="11"
									font-weight="500"
									fill="white"
								>
									{node.data.name}
								</text>
							{/if}
							{#if w > 60 && h > 44}
								<text
									x={(node.x0 ?? 0) + 6}
									y={(node.y0 ?? 0) + 30}
									class="pointer-events-none select-none"
									font-size="10"
									fill="white"
									fill-opacity="0.9"
								>
									{fmt(node.value ?? 0)}
								</text>
							{/if}
						</g>
					{/if}
				{/each}
			</svg>
		{/if}

		{#if hovered}
			<div
				class="pointer-events-none absolute z-10 max-w-xs rounded-md bg-gray-900/95 px-3 py-2 text-xs text-white shadow-lg"
				style={`left:${Math.min(hovered.x + 12, containerWidth - 200)}px; top:${Math.max(hovered.y - 12, 0)}px`}
			>
				<p class="text-[10px] uppercase tracking-wide text-gray-300">{hovered.categoryName}</p>
				<p class="mt-0.5 font-medium">{hovered.leafName}</p>
				<p class="mt-1 text-sm font-semibold">{fmt(hovered.value)}</p>
				<p class="text-[11px] text-gray-300">{hovered.share.toFixed(1)}% do total</p>
			</div>
		{/if}
	</div>
{/if}
