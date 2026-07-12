<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { Category } from '$lib/types/app';

	let {
		data,
		form
	}: {
		data: { categories: Category[]; hiddenCategories: Category[] };
		form?: { success?: boolean; message?: string };
	} = $props();
	let categories = $derived(data.categories ?? []);
	let hiddenCategories = $derived(data.hiddenCategories ?? []);
	let parentCategories = $derived(
		categories.filter((category) => !category.parent_id)
	);

	function subcategoriesFor(categoryId: string) {
		return categories.filter((category) => category.parent_id === categoryId);
	}

	function isPersonal(category: Category) {
		return !!category.created_by_user_id;
	}

	function originLabel(category: Category) {
		return isPersonal(category) ? 'Pessoal' : 'Sugestão oficial';
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold text-gray-900">Categorias</h2>
		<a
			href={resolve('/app/rules')}
			class="text-sm text-gray-600 hover:text-gray-900">Ver regras</a
		>
	</div>

	{#if form?.message}
		<p class={`text-sm ${form.success ? 'text-green-600' : 'text-red-600'}`}>
			{form.message}
		</p>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
		<form
			method="POST"
			action="?/create_category"
			use:enhance
			class="bg-white p-4 rounded-lg shadow space-y-3"
		>
			<h3 class="text-sm font-semibold text-gray-900">
				Nova categoria pessoal
			</h3>
			<div>
				<label
					for="category-name"
					class="block text-xs font-medium text-gray-700">Nome</label
				>
				<input
					id="category-name"
					name="name"
					type="text"
					required
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-3 py-2"
				/>
			</div>
			<div class="flex justify-end">
				<button
					type="submit"
					class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700"
					>Criar categoria</button
				>
			</div>
		</form>

		<form
			method="POST"
			action="?/create_subcategory"
			use:enhance
			class="bg-white p-4 rounded-lg shadow space-y-3"
		>
			<h3 class="text-sm font-semibold text-gray-900">
				Nova subcategoria pessoal
			</h3>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
				<div>
					<label for="parent-id" class="block text-xs font-medium text-gray-700"
						>Categoria</label
					>
					<select
						id="parent-id"
						name="parent_id"
						required
						class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-3 py-2"
					>
						<option value="">Selecione...</option>
						{#each parentCategories as category (category.id)}
							<option value={category.id}>{category.name}</option>
						{/each}
					</select>
				</div>
				<div>
					<label
						for="subcategory-name"
						class="block text-xs font-medium text-gray-700">Subcategoria</label
					>
					<input
						id="subcategory-name"
						name="name"
						type="text"
						required
						class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-3 py-2"
					/>
				</div>
			</div>
			<div class="flex justify-end">
				<button
					type="submit"
					class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700"
					>Criar subcategoria</button
				>
			</div>
		</form>
	</div>

	<div class="bg-white rounded-lg shadow overflow-hidden">
		<table class="min-w-full divide-y divide-gray-200 text-sm">
			<thead class="bg-gray-50">
				<tr>
					<th
						class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase"
						>Categoria</th
					>
					<th
						class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase"
						>Subcategorias</th
					>
					<th
						class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase"
						>Origem</th
					>
					<th
						class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase"
						>Ações</th
					>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-200">
				{#each parentCategories as category (category.id)}
					<tr>
						<td class="px-4 py-3 font-medium text-gray-900">{category.name}</td>
						<td class="px-4 py-3 text-gray-700">
							<div class="flex flex-wrap gap-2">
								{#each subcategoriesFor(category.id) as subcategory (subcategory.id)}
									<span
										class="inline-flex items-center gap-2 rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
									>
										{subcategory.name}
										<form
											method="POST"
											action="?/delete"
											use:enhance
											class="inline"
										>
											<input
												type="hidden"
												name="category_id"
												value={subcategory.id}
											/>
											<button
												type="submit"
												class="text-red-600 hover:text-red-800">Excluir</button
											>
										</form>
									</span>
								{/each}
								{#if subcategoriesFor(category.id).length === 0}
									<span class="text-gray-400">Sem subcategorias</span>
								{/if}
							</div>
						</td>
						<td class="px-4 py-3 text-gray-600">{originLabel(category)}</td>
						<td class="px-4 py-3 text-right">
							<form method="POST" action="?/delete" use:enhance class="inline">
								<input type="hidden" name="category_id" value={category.id} />
								<button
									type="submit"
									class="text-sm text-red-600 hover:text-red-800"
									>Excluir</button
								>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if hiddenCategories.length > 0}
		<div class="bg-white rounded-lg shadow overflow-hidden">
			<table class="min-w-full divide-y divide-gray-200 text-sm">
				<thead class="bg-gray-50">
					<tr>
						<th
							class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase"
							>Sugestões excluídas</th
						>
						<th
							class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase"
							>Tipo</th
						>
						<th
							class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase"
							>Ações</th
						>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-200">
					{#each hiddenCategories as category (category.id)}
						<tr>
							<td class="px-4 py-3 font-medium text-gray-900"
								>{category.name}</td
							>
							<td class="px-4 py-3 text-gray-600"
								>{category.parent_id ? 'Subcategoria' : 'Categoria'}</td
							>
							<td class="px-4 py-3 text-right">
								<form
									method="POST"
									action="?/restore"
									use:enhance
									class="inline"
								>
									<input type="hidden" name="category_id" value={category.id} />
									<button
										type="submit"
										class="text-sm text-indigo-600 hover:text-indigo-800"
										>Restaurar</button
									>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
