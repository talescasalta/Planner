<script lang="ts">
	import { ChevronDown } from 'lucide-svelte';
	import type { TreemapSelection } from './CategoryTreemap.svelte';

	type Leaf = { id: string; name: string; total: number };
	type Group = { id: string; name: string; total: number; children: Leaf[] };

	// Touch-friendly stand-in for the treemap: one bar per category, tap to
	// open its subcategories, tap a subcategory to select it.
	let {
		nodes,
		currency = 'BRL',
		selected = null,
		onSelect,
		emptyMessage = 'Sem despesas para os filtros atuais.'
	}: {
		nodes: Group[];
		currency?: string;
		selected?: TreemapSelection | null;
		onSelect?: (sel: TreemapSelection | null) => void;
		emptyMessage?: string;
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
	const ROW_CLASS =
		'flex min-h-11 w-full flex-col justify-center gap-1 px-1 py-2 text-left';

	let expandedId = $state<string | null>(null);
	let max = $derived(Math.max(1, ...nodes.map((node) => node.total)));

	function fmt(value: number) {
		return value.toLocaleString('pt-BR', { style: 'currency', currency });
	}

	function widthOf(value: number, limit: number) {
		return `${Math.max(2, (value / limit) * 100)}%`;
	}

	// A category with no subcategories behaves like the treemap's "-self" leaf.
	function leavesOf(group: Group): Leaf[] {
		return group.children.length
			? group.children
			: [{ id: `${group.id}-self`, name: group.name, total: group.total }];
	}

	function isSelected(group: Group, leaf: Leaf) {
		return (
			selected?.categoryId === group.id && selected?.subcategoryId === leaf.id
		);
	}

	function pick(group: Group, leaf: Leaf) {
		onSelect?.(
			isSelected(group, leaf)
				? null
				: {
						categoryId: group.id,
						subcategoryId: leaf.id,
						categoryName: group.name,
						subcategoryName: leaf.name
					}
		);
	}

	function onGroupTap(group: Group) {
		const leaves = leavesOf(group);
		if (group.children.length === 0 || leaves.length === 0) {
			pick(group, leaves[0]);
			return;
		}
		expandedId = expandedId === group.id ? null : group.id;
	}
</script>

{#if nodes.length === 0}
	<div
		class="flex h-40 items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500"
	>
		{emptyMessage}
	</div>
{:else}
	<ul class="divide-y divide-gray-100">
		{#each nodes as group, index (group.id)}
			{@const color = PALETTE[index % PALETTE.length]}
			{@const expandable = group.children.length > 0}
			<li>
				<button
					type="button"
					class="{ROW_CLASS} {selected?.categoryId === group.id
						? 'bg-gray-50'
						: ''}"
					aria-expanded={expandable ? expandedId === group.id : undefined}
					onclick={() => onGroupTap(group)}
				>
					<span class="flex items-center justify-between gap-3 text-sm">
						<span class="flex min-w-0 items-center gap-1 text-gray-900">
							{#if expandable}
								<ChevronDown
									class="h-4 w-4 shrink-0 text-gray-400 transition-transform {expandedId ===
									group.id
										? 'rotate-180'
										: ''}"
								/>
							{/if}
							<span class="truncate font-medium">{group.name}</span>
						</span>
						<span class="shrink-0 text-gray-700">{fmt(group.total)}</span>
					</span>
					<span class="block h-2 rounded bg-gray-100">
						<span
							class="block h-2 rounded"
							style:width={widthOf(group.total, max)}
							style:background-color={color}
						></span>
					</span>
				</button>
				{#if expandable && expandedId === group.id}
					<ul
						class="mb-2 ml-5 divide-y divide-gray-50 border-l border-gray-100"
					>
						{#each leavesOf(group) as leaf (leaf.id)}
							<li>
								<button
									type="button"
									class="{ROW_CLASS} {isSelected(group, leaf)
										? 'bg-indigo-50'
										: ''}"
									onclick={() => pick(group, leaf)}
								>
									<span class="flex items-center justify-between gap-3 text-sm">
										<span class="truncate text-gray-800">{leaf.name}</span>
										<span class="shrink-0 text-gray-600">{fmt(leaf.total)}</span
										>
									</span>
									<span class="block h-1.5 rounded bg-gray-100">
										<span
											class="block h-1.5 rounded"
											style:width={widthOf(leaf.total, group.total)}
											style:background-color={color}
											style:opacity="0.7"
										></span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
