<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { TransactionNewPageData } from '$lib/types/page-data';
	import type { ActionData } from './$types';
	import ManualEntryFields, {
		type DraftRow
	} from '$lib/components/transactions/ManualEntryFields.svelte';

	type BatchFormState = ActionData & {
		rows?: DraftRow[];
		rowErrors?: Record<number, string>;
	};

	let { data, form }: { data: TransactionNewPageData; form?: BatchFormState } =
		$props();

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

	// The row inputs share their names, so only one layout may be in the DOM.
	const WIDE_QUERY = '(min-width: 768px)';
	let isWide = $state(true);
	$effect(() => {
		const query = window.matchMedia(WIDE_QUERY);
		const sync = () => (isWide = query.matches);
		sync();
		query.addEventListener('change', sync);
		return () => query.removeEventListener('change', sync);
	});

	// Below sm the save bar pins above the bottom navigation.
	const SAVE_BAR =
		'fixed inset-x-0 bottom-16 z-20 flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3 shadow-lg sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none';

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
		return categoryId
			? categories.filter((c) => c.parent_id === categoryId)
			: [];
	}

	function updateCategory(index: number, value: string) {
		rows[index].category_id = value;
		if (
			!subcategoriesFor(value).some(
				(sub) => sub.id === rows[index].subcategory_id
			)
		) {
			rows[index].subcategory_id = '';
		}
	}
</script>

<div class="mx-auto max-w-7xl space-y-6">
	<div class="space-y-2">
		<h2 class="text-xl font-semibold text-gray-900">Novas transações</h2>
		<p class="text-sm text-gray-600">
			Preencha várias linhas e registre tudo de uma vez. Linhas completamente
			vazias são ignoradas.
		</p>
	</div>

	<form method="POST" use:enhance class="space-y-4">
		<div
			class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
		>
			{#if isWide}
				<div class="overflow-x-auto">
					<table class="min-w-[1320px] divide-y divide-gray-200 text-sm">
						<thead
							class="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"
						>
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
							{#each rows as row, index (row)}
								<tr class="bg-white">
									<ManualEntryFields
										bind:row={rows[index]}
										{index}
										layout="cells"
										{parentCategories}
										{subcategoriesFor}
										{profiles}
										{members}
										onCategoryChange={updateCategory}
									/>
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
										<td
											colspan="11"
											class="px-3 pb-3 pt-0 text-sm text-red-700"
										>
											Linha {index + 1}: {form.rowErrors[index]}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<ul class="divide-y divide-gray-100">
					{#each rows as row, index (row)}
						<li class="space-y-3 p-4">
							<p class="text-sm font-medium text-gray-700">Linha {index + 1}</p>
							<ManualEntryFields
								bind:row={rows[index]}
								{index}
								layout="stack"
								{parentCategories}
								{subcategoriesFor}
								{profiles}
								{members}
								onCategoryChange={updateCategory}
							/>
							{#if form?.rowErrors?.[index]}
								<p class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
									Linha {index + 1}: {form.rowErrors[index]}
								</p>
							{/if}
							<button
								type="button"
								onclick={() => removeRow(index)}
								class="min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
							>
								Remover linha
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<div
				class="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3"
			>
				<button
					type="button"
					onclick={addRow}
					class="min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 md:min-h-0"
				>
					Adicionar linha
				</button>
				<p class="text-xs text-gray-500">
					Dica: deixe linhas vazias no final sem problema.
				</p>
			</div>
		</div>

		<div class={SAVE_BAR}>
			<a
				href={resolve('/app/transactions')}
				class="text-sm text-gray-600 hover:text-gray-900">Cancelar</a
			>
			<button
				type="submit"
				class="min-h-11 rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 sm:min-h-0"
			>
				Registrar transações
			</button>
		</div>

		<div class="h-16 sm:hidden" aria-hidden="true"></div>

		{#if form && !form.success}
			<p class="text-sm text-red-600">{form.message}</p>
		{/if}
	</form>
</div>
