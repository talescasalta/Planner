<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ClassificationRule, Category, FinancialProfile } from '$lib/types/app';

	let { data, form }: { data: { rules: ClassificationRule[]; categories: Category[]; profiles: FinancialProfile[] }; form?: { success?: boolean; message?: string } } = $props();
	let rules = $derived(data.rules ?? []);
	let categories = $derived(data.categories ?? []);
	let profiles = $derived(data.profiles ?? []);
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

<div class="max-w-4xl mx-auto space-y-6">
	<h2 class="text-xl font-semibold text-gray-900">Regras de Classificação</h2>

	<form method="POST" action="?/create" use:enhance class="bg-white p-4 rounded-lg shadow space-y-3">
		<h3 class="text-sm font-semibold text-gray-900">Nova regra</h3>
		<div class="grid grid-cols-1 md:grid-cols-4 gap-3">
			<div class="md:col-span-2">
				<label for="rule-pattern" class="block text-xs font-medium text-gray-700">Padrão</label>
				<input id="rule-pattern" name="pattern" type="text" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1" />
			</div>
			<div>
				<label for="rule-pattern-type" class="block text-xs font-medium text-gray-700">Tipo</label>
				<select id="rule-pattern-type" name="pattern_type" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1">
					<option value="exact_merchant">exact_merchant</option>
					<option value="merchant_contains">merchant_contains</option>
					<option value="description_contains">description_contains</option>
					<option value="regex">regex</option>
				</select>
			</div>
			<div>
				<label for="rule-confidence" class="block text-xs font-medium text-gray-700">Confiança</label>
				<input id="rule-confidence" name="confidence" type="number" step="0.01" min="0" max="1" value="0.95" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1" />
			</div>
		</div>
		<div class="grid grid-cols-1 md:grid-cols-3 gap-3">
			<div>
				<label for="rule-category" class="block text-xs font-medium text-gray-700">Categoria</label>
				<select id="rule-category" name="category_id" required bind:value={selectedCategoryId} onchange={() => (selectedSubcategoryId = '')} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1">
					<option value="">Selecione...</option>
					{#each parentCategories as c}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="rule-subcategory" class="block text-xs font-medium text-gray-700">Subcategoria</label>
				<select id="rule-subcategory" name="subcategory_id" disabled={!selectedCategoryId} bind:value={selectedSubcategoryId} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1 disabled:bg-gray-100">
					<option value="">Selecione...</option>
					{#each subcategories as s}
						<option value={s.id}>{s.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="rule-profile" class="block text-xs font-medium text-gray-700">Atribuir a</label>
				<select id="rule-profile" name="owner_profile_id" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1">
					<option value="">Selecione...</option>
					{#each profiles as p}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</div>
		</div>
		<div class="flex justify-end">
			<button type="submit" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700">Criar regra</button>
		</div>
		{#if form?.success}
			<p class="text-sm text-green-600">Regra criada.</p>
		{/if}
		{#if form && !form.success}
			<p class="text-sm text-red-600">{form.message}</p>
		{/if}
	</form>

	<div class="bg-white rounded-lg shadow overflow-hidden">
		<table class="min-w-full divide-y divide-gray-200 text-sm">
			<thead class="bg-gray-50">
				<tr>
					<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Padrão</th>
					<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
					<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Categoria</th>
					<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Subcategoria</th>
					<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Atribuir a</th>
					<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Confiança</th>
					<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ativa</th>
					<th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Ações</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-200">
				{#each rules as rule}
					<tr>
						<td class="px-4 py-2 font-mono text-xs">{rule.pattern}</td>
						<td class="px-4 py-2">{rule.pattern_type}</td>
						<td class="px-4 py-2">{rule.category?.name ?? '-'}</td>
						<td class="px-4 py-2">{rule.subcategory?.name ?? '-'}</td>
						<td class="px-4 py-2">{rule.owner_profile?.name ?? '-'}</td>
						<td class="px-4 py-2">{rule.confidence}</td>
						<td class="px-4 py-2">
							{#if rule.active}
								<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Sim</span>
							{:else}
								<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">Não</span>
							{/if}
						</td>
						<td class="px-4 py-2 text-right space-x-2">
							<form method="POST" action="?/toggle" use:enhance class="inline">
								<input type="hidden" name="rule_id" value={rule.id} />
								<input type="hidden" name="active" value={rule.active ? 'false' : 'true'} />
								<button type="submit" class="text-xs text-indigo-600 hover:text-indigo-900">{rule.active ? 'Desativar' : 'Ativar'}</button>
							</form>
							<form method="POST" action="?/delete" use:enhance class="inline">
								<input type="hidden" name="rule_id" value={rule.id} />
								<button type="submit" class="text-xs text-red-600 hover:text-red-900">Excluir</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
