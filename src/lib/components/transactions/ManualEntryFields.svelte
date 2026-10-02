<script lang="ts" module>
	export type DraftRow = {
		date: string;
		description: string;
		merchant: string;
		amount: string;
		source_name: string;
		paid_by_user_id: string;
		owner_profile_id: string;
		split_method: string;
		category_id: string;
		subcategory_id: string;
	};
	export type DraftMember = {
		user_id: string;
		profiles?: { display_name?: string | null } | null;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Category, FinancialProfile } from '$lib/types/app';

	// One draft row of the manual-entry form. `cells` renders table cells for the
	// desktop grid; `stack` renders labelled, full-width fields for a phone card.
	let {
		row = $bindable(),
		index,
		layout,
		parentCategories,
		subcategoriesFor,
		profiles,
		members,
		onCategoryChange
	}: {
		row: DraftRow;
		index: number;
		layout: 'cells' | 'stack';
		parentCategories: Category[];
		subcategoriesFor: (categoryId: string) => Category[];
		profiles: FinancialProfile[];
		members: DraftMember[];
		onCategoryChange: (index: number, value: string) => void;
	} = $props();

	const WIDTHS = {
		date: 'w-36',
		description: 'w-64',
		merchant: 'w-52',
		amount: 'w-32',
		category: 'w-48',
		subcategory: 'w-48',
		owner: 'w-44',
		split: 'w-40',
		payer: 'w-44',
		source: 'w-40'
	};
	const CONTROL = 'rounded-md border border-gray-300 px-3 py-2';

	function cls(key: keyof typeof WIDTHS, extra = '') {
		const size = layout === 'cells' ? WIDTHS[key] : 'w-full min-h-11';
		return `${size} ${CONTROL} ${extra}`;
	}

	const fieldName = (key: keyof DraftRow) => `rows[${index}].${key}`;
</script>

{#snippet field(label: string, control: Snippet)}
	{#if layout === 'cells'}
		<td class="px-3 py-3">{@render control()}</td>
	{:else}
		<label class="block text-xs font-medium text-gray-600">
			{label}
			<span class="mt-1 block">{@render control()}</span>
		</label>
	{/if}
{/snippet}

{#snippet date()}
	<input
		name={fieldName('date')}
		type="date"
		bind:value={row.date}
		class={cls('date')}
	/>
{/snippet}
{#snippet description()}
	<input
		name={fieldName('description')}
		type="text"
		bind:value={row.description}
		placeholder="Ex.: Mercado"
		class={cls('description')}
	/>
{/snippet}
{#snippet merchant()}
	<input
		name={fieldName('merchant')}
		type="text"
		bind:value={row.merchant}
		placeholder="Opcional"
		class={cls('merchant')}
	/>
{/snippet}
{#snippet amount()}
	<input
		name={fieldName('amount')}
		type="number"
		step="0.01"
		bind:value={row.amount}
		placeholder="0,00"
		class={cls('amount')}
	/>
{/snippet}
{#snippet category()}
	<select
		name={fieldName('category_id')}
		bind:value={row.category_id}
		onchange={(event) =>
			onCategoryChange(index, (event.currentTarget as HTMLSelectElement).value)}
		class={cls('category')}
	>
		<option value="">Selecione...</option>
		{#each parentCategories as cat (cat.id)}
			<option value={cat.id}>{cat.name}</option>
		{/each}
	</select>
{/snippet}
{#snippet subcategory()}
	<select
		name={fieldName('subcategory_id')}
		bind:value={row.subcategory_id}
		disabled={!row.category_id}
		class={cls('subcategory', 'disabled:bg-gray-100')}
	>
		<option value="">Selecione...</option>
		{#each subcategoriesFor(row.category_id) as sub (sub.id)}
			<option value={sub.id}>{sub.name}</option>
		{/each}
	</select>
{/snippet}
{#snippet owner()}
	<select
		name={fieldName('owner_profile_id')}
		bind:value={row.owner_profile_id}
		class={cls('owner')}
	>
		<option value="">Selecione...</option>
		{#each profiles as profile (profile.id)}
			<option value={profile.id}>{profile.name}</option>
		{/each}
	</select>
{/snippet}
{#snippet split()}
	<select
		name={fieldName('split_method')}
		bind:value={row.split_method}
		class={cls('split')}
	>
		<option value="income_proportional">Por renda</option>
		<option value="equal">50/50</option>
	</select>
{/snippet}
{#snippet payer()}
	<select
		name={fieldName('paid_by_user_id')}
		bind:value={row.paid_by_user_id}
		class={cls('payer')}
	>
		<option value="">Selecione...</option>
		{#each members as member (member.user_id)}
			<option value={member.user_id}
				>{member.profiles?.display_name ?? member.user_id}</option
			>
		{/each}
	</select>
{/snippet}
{#snippet source()}
	<input
		name={fieldName('source_name')}
		type="text"
		bind:value={row.source_name}
		placeholder="Opcional"
		class={cls('source')}
	/>
{/snippet}

{@render field('Data', date)}
{@render field('Descrição', description)}
{@render field('Comerciante', merchant)}
{@render field('Valor', amount)}
{@render field('Categoria', category)}
{@render field('Subcategoria', subcategory)}
{@render field('Atribuir a', owner)}
{@render field('Divisão', split)}
{@render field('Pago por', payer)}
{@render field('Fonte', source)}
