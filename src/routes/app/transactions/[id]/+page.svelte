<script lang="ts">
	import { enhance } from '$app/forms';
	import type { TransactionDetailPageData } from '$lib/types/page-data';
	import type { ActionData } from './$types';

	let { data, form }: { data: TransactionDetailPageData; form: ActionData } = $props();
	let tx = $derived(data.transaction);
	let editable = $derived(data.editable);
	let categories = $derived(data.categories ?? []);
	let profiles = $derived(data.profiles ?? []);
	let members = $derived(data.members ?? []);
	let parentCategories = $derived(categories.filter((c) => !c.parent_id));
	let selectedCategoryId = $state<string | null>(null);
	let selectedSubcategoryId = $state<string | null>(null);
	$effect(() => {
		// keep subcategory list in sync with the currently chosen category
		selectedCategoryId = tx.category_id ?? null;
		selectedSubcategoryId = tx.subcategory_id ?? null;
	});
	let subcategories = $derived(
		selectedCategoryId ? categories.filter((c) => c.parent_id === selectedCategoryId) : []
	);

	$effect(() => {
		if (selectedSubcategoryId && !subcategories.some((sub) => sub.id === selectedSubcategoryId)) {
			selectedSubcategoryId = null;
		}
	});
</script>

<div class="max-w-2xl mx-auto space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold text-gray-900">Detalhe da transação</h2>
		<a href="/app/transactions" class="text-sm text-gray-600 hover:text-gray-900">Voltar</a>
	</div>

	{#if form?.success}
		<div class="rounded-md bg-green-50 p-4 text-sm text-green-800">Transação atualizada.</div>
	{/if}

	<form method="POST" use:enhance class="space-y-4 bg-white p-6 rounded-lg shadow">
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<label for="date" class="block text-sm font-medium text-gray-700">Data</label>
				<input id="date" name="date" type="date" value={tx.date} disabled={!editable} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100" />
			</div>

			<div>
				<label for="amount" class="block text-sm font-medium text-gray-700">Valor</label>
				<input id="amount" name="amount" type="number" step="0.01" value={tx.amount} disabled={!editable} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100" />
			</div>
		</div>

		<div>
			<label for="description" class="block text-sm font-medium text-gray-700">Descrição</label>
			<input id="description" name="description" type="text" value={tx.description} disabled={!editable} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100" />
		</div>

		<div>
			<label for="merchant" class="block text-sm font-medium text-gray-700">Comerciante</label>
			<input id="merchant" name="merchant" type="text" value={tx.merchant ?? ''} disabled={!editable} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100" />
		</div>

		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div>
				<label for="category_id" class="block text-sm font-medium text-gray-700">Categoria</label>
				<select id="category_id" name="category_id" disabled={!editable} bind:value={selectedCategoryId} onchange={() => (selectedSubcategoryId = null)} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100">
					<option value="">Selecione...</option>
					{#each parentCategories as cat}
						<option value={cat.id}>{cat.name}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="subcategory_id" class="block text-sm font-medium text-gray-700">Subcategoria</label>
				<select id="subcategory_id" name="subcategory_id" disabled={!editable || !selectedCategoryId} bind:value={selectedSubcategoryId} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100">
					<option value="">Selecione...</option>
					{#each subcategories as sub}
						<option value={sub.id}>{sub.name}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="owner_profile_id" class="block text-sm font-medium text-gray-700">Atribuir a</label>
				<select id="owner_profile_id" name="owner_profile_id" disabled={!editable} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100">
					<option value="">Selecione...</option>
					{#each profiles as p}
						<option value={p.id} selected={p.id === tx.owner_profile_id}>{p.name}</option>
					{/each}
				</select>
			</div>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<label for="paid_by_user_id" class="block text-sm font-medium text-gray-700">Pago por</label>
				<select id="paid_by_user_id" name="paid_by_user_id" disabled={!editable} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100">
					<option value="">Selecione...</option>
					{#each members as m}
						<option value={m.user_id} selected={m.user_id === tx.paid_by_user_id}>{m.display_name ?? m.user_id}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="source_name" class="block text-sm font-medium text-gray-700">Fonte</label>
				<input id="source_name" name="source_name" type="text" value={tx.source_name ?? ''} disabled={!editable} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100" />
			</div>
		</div>

		<div>
			<label for="review_status" class="block text-sm font-medium text-gray-700">Status de revisão</label>
			<input id="review_status" type="text" value={tx.review_status} disabled class="mt-1 block w-full rounded-md border-gray-300 shadow-sm px-3 py-2 disabled:bg-gray-100" />
		</div>

		{#if editable}
			<div class="flex justify-between gap-3 pt-4">
				<button
					type="submit"
					form="delete-transaction-form"
					class="px-4 py-2 border border-red-200 rounded-md shadow-sm text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100"
				>
					Excluir transação
				</button>
				<button type="submit" class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Salvar alterações</button>
			</div>
		{/if}

		{#if form && !form.success}
			<p class="text-sm text-red-600">{form.message}</p>
		{/if}
	</form>

	{#if editable}
		<form
			id="delete-transaction-form"
			method="POST"
			action="?/delete"
			onsubmit={(event) => {
				if (!confirm('Excluir esta transação?')) event.preventDefault();
			}}
		></form>
	{/if}
</div>
