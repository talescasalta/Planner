<script lang="ts">
	import { enhance } from '$app/forms';
	import type { TransactionNewPageData } from '$lib/types/page-data';
	import type { ActionData } from './$types';

	let { data, form }: { data: TransactionNewPageData; form: ActionData } = $props();

	let categories = $derived(data.categories ?? []);
	let profiles = $derived(data.profiles ?? []);
	let members = $derived(data.members ?? []);
	let parentCategories = $derived(categories.filter((c) => !c.parent_id));
	let selectedCategoryId = $state('');
	let selectedSubcategoryId = $state('');
	let subcategories = $derived(
		selectedCategoryId ? categories.filter((c) => c.parent_id === selectedCategoryId) : []
	);

	$effect(() => {
		if (selectedSubcategoryId && !subcategories.some((sub) => sub.id === selectedSubcategoryId)) {
			selectedSubcategoryId = '';
		}
	});
</script>

<div class="max-w-2xl mx-auto space-y-6">
	<h2 class="text-xl font-semibold text-gray-900">Nova transação</h2>

	<form method="POST" use:enhance class="space-y-4 bg-white p-6 rounded-lg shadow">
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<label for="date" class="block text-sm font-medium text-gray-700">Data</label>
				<input id="date" name="date" type="date" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2" />
			</div>

			<div>
				<label for="amount" class="block text-sm font-medium text-gray-700">Valor</label>
				<input id="amount" name="amount" type="number" step="0.01" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2" />
			</div>
		</div>

		<div>
			<label for="description" class="block text-sm font-medium text-gray-700">Descrição</label>
			<input id="description" name="description" type="text" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2" />
		</div>

		<div>
			<label for="merchant" class="block text-sm font-medium text-gray-700">Comerciante</label>
			<input id="merchant" name="merchant" type="text" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2" />
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<label for="category_id" class="block text-sm font-medium text-gray-700">Categoria</label>
				<select id="category_id" name="category_id" bind:value={selectedCategoryId} onchange={() => (selectedSubcategoryId = '')} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2">
					<option value="">Selecione...</option>
					{#each parentCategories as cat}
						<option value={cat.id}>{cat.name}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="subcategory_id" class="block text-sm font-medium text-gray-700">Subcategoria</label>
				<select id="subcategory_id" name="subcategory_id" disabled={!selectedCategoryId} bind:value={selectedSubcategoryId} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100">
					<option value="">Selecione...</option>
					{#each subcategories as sub}
						<option value={sub.id}>{sub.name}</option>
					{/each}
				</select>
			</div>
		</div>

		<div>
			<label for="owner_profile_id" class="block text-sm font-medium text-gray-700">Atribuir a</label>
				<select id="owner_profile_id" name="owner_profile_id" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2">
					<option value="">Selecione...</option>
					{#each profiles as p}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<label for="paid_by_user_id" class="block text-sm font-medium text-gray-700">Pago por</label>
				<select id="paid_by_user_id" name="paid_by_user_id" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2">
					<option value="">Selecione...</option>
					{#each members as m}
						<option value={m.user_id}>{m.profiles?.display_name ?? m.user_id}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="source_name" class="block text-sm font-medium text-gray-700">Fonte</label>
				<input id="source_name" name="source_name" type="text" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2" />
			</div>
		</div>

		<div class="flex items-center justify-between pt-4">
			<a href="/app/transactions" class="text-sm text-gray-600 hover:text-gray-900">Cancelar</a>
			<button type="submit" class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Salvar</button>
		</div>

		{#if form && !form.success}
			<p class="text-sm text-red-600">{form.message}</p>
		{/if}
	</form>
</div>
