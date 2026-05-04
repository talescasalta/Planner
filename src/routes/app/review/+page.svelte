<script lang="ts">
	import { enhance } from '$app/forms';
	import type { Transaction, Category, FinancialProfile } from '$lib/types/app';

	let { data, form }: { data: { transactions: Transaction[]; categories: Category[]; profiles: FinancialProfile[] }; form?: { success?: boolean; message?: string } } = $props();
	let transactions = $derived(data.transactions ?? []);
	let categories = $derived(data.categories ?? []);
	let profiles = $derived(data.profiles ?? []);
	let parentCategories = $derived(categories.filter((c) => !c.parent_id));
	let selectedCategories = $state<Record<string, string>>({});
	let selectedSubcategories = $state<Record<string, string>>({});

	$effect(() => {
		for (const tx of transactions) {
			if (!(tx.id in selectedCategories)) selectedCategories[tx.id] = tx.category_id ?? '';
			if (!(tx.id in selectedSubcategories)) selectedSubcategories[tx.id] = tx.subcategory_id ?? '';
			if (!isSelectedSubcategoryValid(tx.id)) selectedSubcategories[tx.id] = '';
		}
	});

	function subcategoriesFor(transactionId: string) {
		const categoryId = selectedCategories[transactionId];
		return categoryId ? categories.filter((c) => c.parent_id === categoryId) : [];
	}

	function isSelectedSubcategoryValid(transactionId: string) {
		const subcategoryId = selectedSubcategories[transactionId];
		return !subcategoryId || subcategoriesFor(transactionId).some((sub) => sub.id === subcategoryId);
	}
</script>

<div class="max-w-4xl mx-auto space-y-6">
	<h2 class="text-xl font-semibold text-gray-900">Fila de Revisão</h2>

	{#if transactions.length === 0}
		<p class="text-gray-600">Nenhuma transação pendente de revisão.</p>
	{:else}
		<div class="space-y-4">
			{#each transactions as tx}
				<form method="POST" use:enhance class="bg-white p-4 rounded-lg shadow space-y-3">
					<input type="hidden" name="transaction_id" value={tx.id} />

					<div class="flex items-center justify-between">
						<div>
							<p class="text-sm font-medium text-gray-900">{tx.description}</p>
							<p class="text-xs text-gray-500">{tx.date} — {tx.amount.toLocaleString('pt-BR', { style: 'currency', currency: tx.currency ?? 'BRL' })}</p>
						</div>
						<div class="text-right">
							<p class="text-xs text-gray-500">Método: {tx.classification_method}</p>
							{#if tx.classification_suggestion}
								<p class="text-xs text-gray-500">Confiança: {tx.classification_confidence ?? '-'}</p>
							{/if}
						</div>
					</div>

					<div class="grid grid-cols-1 md:grid-cols-4 gap-3">
						<div>
							<label for="cat-{tx.id}" class="block text-xs font-medium text-gray-700">Categoria</label>
							<select
								id="cat-{tx.id}"
								name="category_id"
								bind:value={selectedCategories[tx.id]}
								onchange={() => (selectedSubcategories[tx.id] = '')}
								class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1"
							>
								<option value="">Selecione...</option>
								{#each parentCategories as cat}
									<option value={cat.id}>{cat.name}</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="sub-{tx.id}" class="block text-xs font-medium text-gray-700">Subcategoria</label>
							<select id="sub-{tx.id}" name="subcategory_id" disabled={!selectedCategories[tx.id]} bind:value={selectedSubcategories[tx.id]} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1 disabled:bg-gray-100">
								<option value="">Selecione...</option>
								{#each subcategoriesFor(tx.id) as sub}
									<option value={sub.id}>{sub.name}</option>
								{/each}
							</select>
						</div>

						<div>
							<label for="prof-{tx.id}" class="block text-xs font-medium text-gray-700">Atribuir a</label>
							<select id="prof-{tx.id}" name="owner_profile_id" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1">
								<option value="">Selecione...</option>
								{#each profiles as p}
									<option value={p.id} selected={p.id === tx.owner_profile_id}>{p.name}</option>
								{/each}
							</select>
						</div>

						<div class="flex items-end gap-3">
							<button type="submit" class="ml-auto px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700">Confirmar</button>
						</div>
					</div>
				</form>
			{/each}
		</div>
	{/if}

	{#if form?.success}
		<p class="text-sm text-green-600">Revisão salva.</p>
	{/if}
	{#if form && !form.success}
		<p class="text-sm text-red-600">{form.message}</p>
	{/if}
</div>
