<script lang="ts">
	import { enhance } from '$app/forms';
	import type { TransactionNewPageData } from '$lib/types/page-data';
	import type { ActionData } from './$types';

	type DraftRow = {
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

	type BatchFormState = ActionData & {
		rows?: DraftRow[];
		rowErrors?: Record<number, string>;
	};

	let { data, form }: { data: TransactionNewPageData; form?: BatchFormState } = $props();

	let categories = $derived(data.categories ?? []);
	let profiles = $derived(data.profiles ?? []);
	let members = $derived(data.members ?? []);
	let parentCategories = $derived(categories.filter((c) => !c.parent_id));

	function createRow(partial: Partial<DraftRow> = {}): DraftRow {
		return {
			date: '',
			description: '',
			merchant: '',
			amount: '',
			source_name: '',
			paid_by_user_id: '',
			owner_profile_id: '',
			split_method: 'income_proportional',
			category_id: '',
			subcategory_id: '',
			...partial
		};
	}

	function initialRows(inputRows?: DraftRow[]) {
		if (inputRows?.length) return inputRows.map((row) => createRow(row));
		return Array.from({ length: 4 }, () => createRow());
	}

	let submittedRows = $derived(form?.rows);
	let rows = $state(initialRows());

	$effect(() => {
		if (submittedRows?.length) {
			rows = initialRows(submittedRows);
		}
	});

	function addRow() {
		rows = [...rows, createRow()];
	}

	function removeRow(index: number) {
		if (rows.length === 1) {
			rows = [createRow()];
			return;
		}

		rows = rows.filter((_, currentIndex) => currentIndex !== index);
	}

	function subcategoriesFor(categoryId: string) {
		return categoryId ? categories.filter((c) => c.parent_id === categoryId) : [];
	}

	function updateCategory(index: number, value: string) {
		rows[index].category_id = value;
		if (!subcategoriesFor(value).some((sub) => sub.id === rows[index].subcategory_id)) {
			rows[index].subcategory_id = '';
		}
	}
</script>

<div class="mx-auto max-w-7xl space-y-6">
	<div class="space-y-2">
		<h2 class="text-xl font-semibold text-gray-900">Novas transações</h2>
		<p class="text-sm text-gray-600">
			Preencha várias linhas e registre tudo de uma vez. Linhas completamente vazias são ignoradas.
		</p>
	</div>

	<form method="POST" use:enhance class="space-y-4">
		<div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
			<div class="overflow-x-auto">
				<table class="min-w-[1320px] divide-y divide-gray-200 text-sm">
					<thead class="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
						<tr>
							<th class="px-3 py-3 font-medium">Data</th>
							<th class="px-3 py-3 font-medium">Descrição</th>
							<th class="px-3 py-3 font-medium">Comerciante</th>
							<th class="px-3 py-3 font-medium">Valor</th>
							<th class="px-3 py-3 font-medium">Categoria</th>
							<th class="px-3 py-3 font-medium">Subcategoria</th>
							<th class="px-3 py-3 font-medium">Atribuir a</th>
							<th class="px-3 py-3 font-medium">Divisão</th>
							<th class="px-3 py-3 font-medium">Pago por</th>
							<th class="px-3 py-3 font-medium">Fonte</th>
							<th class="px-3 py-3 font-medium text-right">Ações</th>
						</tr>
					</thead>

					<tbody class="divide-y divide-gray-100 align-top">
						{#each rows as row, index}
							<tr class="bg-white">
								<td class="px-3 py-3">
									<input
										name={`rows[${index}].date`}
										type="date"
										bind:value={row.date}
										class="w-36 rounded-md border border-gray-300 px-3 py-2"
									/>
								</td>
								<td class="px-3 py-3">
									<input
										name={`rows[${index}].description`}
										type="text"
										bind:value={row.description}
										placeholder="Ex.: Mercado"
										class="w-64 rounded-md border border-gray-300 px-3 py-2"
									/>
								</td>
								<td class="px-3 py-3">
									<input
										name={`rows[${index}].merchant`}
										type="text"
										bind:value={row.merchant}
										placeholder="Opcional"
										class="w-52 rounded-md border border-gray-300 px-3 py-2"
									/>
								</td>
								<td class="px-3 py-3">
									<input
										name={`rows[${index}].amount`}
										type="number"
										step="0.01"
										bind:value={row.amount}
										placeholder="0,00"
										class="w-32 rounded-md border border-gray-300 px-3 py-2"
									/>
								</td>
								<td class="px-3 py-3">
									<select
										name={`rows[${index}].category_id`}
										bind:value={row.category_id}
										onchange={(event) => updateCategory(index, (event.currentTarget as HTMLSelectElement).value)}
										class="w-48 rounded-md border border-gray-300 px-3 py-2"
									>
										<option value="">Selecione...</option>
										{#each parentCategories as cat}
											<option value={cat.id}>{cat.name}</option>
										{/each}
									</select>
								</td>
								<td class="px-3 py-3">
									<select
										name={`rows[${index}].subcategory_id`}
										bind:value={row.subcategory_id}
										disabled={!row.category_id}
										class="w-48 rounded-md border border-gray-300 px-3 py-2 disabled:bg-gray-100"
									>
										<option value="">Selecione...</option>
										{#each subcategoriesFor(row.category_id) as sub}
											<option value={sub.id}>{sub.name}</option>
										{/each}
									</select>
								</td>
								<td class="px-3 py-3">
									<select
										name={`rows[${index}].owner_profile_id`}
										bind:value={row.owner_profile_id}
										class="w-44 rounded-md border border-gray-300 px-3 py-2"
									>
										<option value="">Selecione...</option>
										{#each profiles as profile}
											<option value={profile.id}>{profile.name}</option>
										{/each}
									</select>
								</td>
								<td class="px-3 py-3">
									<select
										name={`rows[${index}].split_method`}
										bind:value={row.split_method}
										class="w-40 rounded-md border border-gray-300 px-3 py-2"
									>
										<option value="income_proportional">Por renda</option>
										<option value="equal">50/50</option>
									</select>
								</td>
								<td class="px-3 py-3">
									<select
										name={`rows[${index}].paid_by_user_id`}
										bind:value={row.paid_by_user_id}
										class="w-44 rounded-md border border-gray-300 px-3 py-2"
									>
										<option value="">Selecione...</option>
										{#each members as member}
											<option value={member.user_id}>{member.profiles?.display_name ?? member.user_id}</option>
										{/each}
									</select>
								</td>
								<td class="px-3 py-3">
									<input
										name={`rows[${index}].source_name`}
										type="text"
										bind:value={row.source_name}
										placeholder="Opcional"
										class="w-40 rounded-md border border-gray-300 px-3 py-2"
									/>
								</td>
								<td class="px-3 py-3 text-right">
									<button
										type="button"
										onclick={() => removeRow(index)}
										class="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
									>
										Remover
									</button>
								</td>
							</tr>

							{#if form?.rowErrors?.[index]}
								<tr class="bg-red-50/70">
									<td colspan="11" class="px-3 pb-3 pt-0 text-sm text-red-700">
										Linha {index + 1}: {form.rowErrors[index]}
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>

			<div class="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3">
				<button
					type="button"
					onclick={addRow}
					class="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
				>
					Adicionar linha
				</button>
				<p class="text-xs text-gray-500">Dica: deixe linhas vazias no final sem problema.</p>
			</div>
		</div>

		<div class="flex items-center justify-between">
			<a href="/app/transactions" class="text-sm text-gray-600 hover:text-gray-900">Cancelar</a>
			<button
				type="submit"
				class="rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
			>
				Registrar transações
			</button>
		</div>

		{#if form && !form.success}
			<p class="text-sm text-red-600">{form.message}</p>
		{/if}
	</form>
</div>
