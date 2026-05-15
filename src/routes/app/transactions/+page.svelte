<script lang="ts">
	import { enhance } from '$app/forms';
	import { ArrowDown, ArrowUp, ArrowUpDown, Ban, Check, Plus, Search, Undo2, X } from 'lucide-svelte';
	import type { TransactionsPageData } from '$lib/types/page-data';
	import type { Transaction } from '$lib/types/app';

	let { data }: { data: TransactionsPageData } = $props();
	let transactions = $derived(data.transactions ?? []);
	let categories = $derived(data.categories ?? []);
	let profiles = $derived(data.profiles ?? []);
	let monthOptions = $derived(data.monthOptions ?? []);
	let selectedMonth = $derived(data.selectedMonth ?? '');
	let summary = $derived(data.summary);
	let parentCategories = $derived(categories.filter((c) => !c.parent_id));
	let selectedForDelete = $state<string[]>([]);
	let editingId = $state<string | null>(null);
	let editCategoryId = $state('');
	let editSubcategoryId = $state('');
	let editOwnerProfileId = $state('');
	let newSubcategoryName = $state('');
	let savingId = $state<string | null>(null);
	let confirmingId = $state<string | null>(null);
	let statusChangingId = $state<string | null>(null);
	let creatingSubcategoryForId = $state<string | null>(null);
	let editSubcategories = $derived(editCategoryId ? categories.filter((c) => c.parent_id === editCategoryId) : []);

	let searchTerm = $state('');
	let amountSort = $state<'none' | 'desc' | 'asc'>('none');

	let visibleTransactions = $derived.by(() => {
		const term = searchTerm.trim().toLowerCase();
		let list = transactions;
		if (term) {
			list = list.filter((tx) => {
				const desc = (tx.description ?? '').toLowerCase();
				const clean = (tx.clean_description ?? '').toLowerCase();
				const cat = (tx.category_display_name ?? '').toLowerCase();
				const sub = (tx.subcategory_display_name ?? '').toLowerCase();
				return desc.includes(term) || clean.includes(term) || cat.includes(term) || sub.includes(term);
			});
		}
		if (amountSort === 'desc') {
			list = [...list].sort((a, b) => Number(b.amount) - Number(a.amount));
		} else if (amountSort === 'asc') {
			list = [...list].sort((a, b) => Number(a.amount) - Number(b.amount));
		}
		return list;
	});

	function cycleAmountSort() {
		amountSort = amountSort === 'none' ? 'desc' : amountSort === 'desc' ? 'asc' : 'none';
	}

	$effect(() => {
		if (editSubcategoryId && !editSubcategories.some((sub) => sub.id === editSubcategoryId)) {
			editSubcategoryId = '';
		}
	});

	function formatCurrency(value: number) {
		return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
	}

	function formatMonth(month: string) {
		if (month === 'all') return 'Todos os meses';
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return month || 'Sem mês';
		return new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', {
			month: 'long',
			year: 'numeric'
		});
	}

	function monthHref(month: string) {
		return `/app/transactions?month=${encodeURIComponent(month)}`;
	}

	function setAllVisible(checked: boolean) {
		selectedForDelete = checked ? visibleTransactions.map((tx) => tx.id) : [];
	}

	function startEdit(tx: Transaction) {
		editingId = tx.id;
		editCategoryId = tx.category_id ?? '';
		editSubcategoryId = tx.subcategory_id ?? '';
		editOwnerProfileId = tx.owner_profile_id ?? '';
		newSubcategoryName = '';
	}

	function cancelEdit() {
		editingId = null;
		editCategoryId = '';
		editSubcategoryId = '';
		editOwnerProfileId = '';
		newSubcategoryName = '';
	}

	function classificationText(tx: Transaction) {
		return tx.category_display_name ?? 'Sem categoria';
	}

	function subcategoryText(tx: Transaction) {
		return tx.subcategory_display_name ?? '';
	}

	function assignmentText(tx: Transaction) {
		return tx.owner_profile?.name ?? 'Sem atribuição';
	}

	function sourceClasses(tx: Transaction) {
		if (tx.classification_display_source === 'suggestion') {
			return 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100';
		}
		if (tx.classification_display_source === 'empty') {
			return 'border-dashed border-gray-300 bg-white text-gray-500 hover:bg-gray-50';
		}
		return 'border-emerald-100 bg-emerald-50 text-emerald-900 hover:bg-emerald-100';
	}

	function keepScrollOnEditSubmit(transactionId: string, submitter: HTMLElement | null) {
		const scrollY = window.scrollY;
		const isCreatingSubcategory =
			submitter instanceof HTMLButtonElement && submitter.formAction.includes('create_subcategory');
		if (isCreatingSubcategory) {
			creatingSubcategoryForId = transactionId;
		} else {
			savingId = transactionId;
		}

		return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: () => Promise<void> }) => {
			await update();
			requestAnimationFrame(() => {
				if (isCreatingSubcategory && result.type === 'success') {
					const createdSubcategoryId = result.data?.createdSubcategoryId;
					if (typeof createdSubcategoryId === 'string') {
						editSubcategoryId = createdSubcategoryId;
						newSubcategoryName = '';
					}
				}
				window.scrollTo({ top: scrollY });
				savingId = null;
				creatingSubcategoryForId = null;
			});
		};
	}

	function keepScrollOnConfirm(transactionId: string) {
		const scrollY = window.scrollY;
		confirmingId = transactionId;

		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			requestAnimationFrame(() => {
				window.scrollTo({ top: scrollY });
				confirmingId = null;
			});
		};
	}

	function keepScrollOnStatusChange(transactionId: string) {
		const scrollY = window.scrollY;
		statusChangingId = transactionId;

		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			requestAnimationFrame(() => {
				window.scrollTo({ top: scrollY });
				statusChangingId = null;
			});
		};
	}
</script>

<div class="space-y-4">
	<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
		<h2 class="text-xl font-semibold text-gray-900">Transações</h2>
		<a
			href="/app/transactions/new"
			class="inline-flex items-center self-start px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 lg:self-auto"
		>
			Nova transação
		</a>
	</div>

	<div class="bg-white shadow rounded-lg p-4 space-y-4">
		<div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
			<div class="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
				<div>
					<label for="month-filter" class="block text-xs font-medium uppercase tracking-wider text-gray-500">Mês da fatura</label>
					<select
						id="month-filter"
						class="mt-1 w-56 rounded-md border-gray-300 shadow-sm text-sm px-3 py-2"
						value={selectedMonth}
						onchange={(event) => {
							const value = event.currentTarget.value;
							window.location.href = monthHref(value);
						}}
					>
						{#if !selectedMonth}
							<option value="">Sem meses</option>
						{/if}
						<option value="all">Todos os meses</option>
						{#each monthOptions as month}
							<option value={month}>{formatMonth(month)}</option>
						{/each}
					</select>
				</div>

				<div class="flex-1">
					<label for="tx-search" class="block text-xs font-medium uppercase tracking-wider text-gray-500">Buscar</label>
					<div class="relative mt-1">
						<Search class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
						<input
							id="tx-search"
							type="search"
							bind:value={searchTerm}
							placeholder="Descrição, categoria, subcategoria..."
							class="w-full rounded-md border-gray-300 pl-8 pr-8 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
						/>
						{#if searchTerm}
							<button
								type="button"
								onclick={() => (searchTerm = '')}
								class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
								aria-label="Limpar busca"
							>
								<X class="h-4 w-4" />
							</button>
						{/if}
					</div>
				</div>
			</div>

			<div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
				<div>
					<p class="text-xs text-gray-500">Transações</p>
					<p class="font-semibold text-gray-900">{summary.count}</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Despesas</p>
					<p class="font-semibold text-red-700">{formatCurrency(summary.expenses)}</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Créditos</p>
					<p class="font-semibold text-green-700">{formatCurrency(summary.credits)}</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Saldo</p>
					<p class="font-semibold text-gray-900">{formatCurrency(summary.balance)}</p>
				</div>
			</div>
		</div>

		{#if selectedMonth && selectedMonth !== 'all' && summary.count > 0}
			<form
				method="POST"
				action="?/delete_month"
				onsubmit={(event) => {
					if (!confirm(`Excluir todas as transações de ${formatMonth(selectedMonth)}?`)) event.preventDefault();
				}}
				class="flex justify-end"
			>
				<input type="hidden" name="reference_month" value={selectedMonth} />
				<button type="submit" class="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100">
					Excluir mês da fatura
				</button>
			</form>
		{/if}
	</div>

	{#if transactions.length === 0}
		<p class="text-gray-600">Nenhuma transação encontrada para este filtro.</p>
	{:else}
		<form
			id="transactions-delete-selected-form"
			method="POST"
			action="?/delete_selected"
			onsubmit={(event) => {
				if (!confirm(`Excluir ${selectedForDelete.length} transações selecionadas?`)) event.preventDefault();
			}}
		>
			<input type="hidden" name="month" value={selectedMonth} />
			<input type="hidden" name="page" value={data.page} />
		</form>

		<div class="flex items-center justify-between">
			<p class="text-sm text-gray-600">{selectedForDelete.length} selecionadas</p>
			<button
				type="submit"
				form="transactions-delete-selected-form"
				disabled={selectedForDelete.length === 0}
				class="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-50 disabled:hover:bg-red-50"
			>
				Excluir selecionadas
			</button>
		</div>

		<div class="overflow-x-auto">
			<table class="min-w-full divide-y divide-gray-200 bg-white shadow rounded-lg">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left">
							<input
								type="checkbox"
								aria-label="Selecionar todas as transações visíveis"
								checked={selectedForDelete.length === transactions.length}
								onchange={(event) => setAllVisible(event.currentTarget.checked)}
							/>
						</th>
						<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
						<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descrição</th>
						<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Classificação</th>
						<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Atribuir a</th>
						<th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
						<button
							type="button"
							onclick={cycleAmountSort}
							class="inline-flex items-center gap-1 hover:text-gray-900 {amountSort !== 'none' ? 'text-indigo-700' : ''}"
							title={amountSort === 'none' ? 'Ordenar por valor' : amountSort === 'desc' ? 'Maior para menor' : 'Menor para maior'}
						>
							Valor
							{#if amountSort === 'desc'}
								<ArrowDown class="h-3.5 w-3.5" />
							{:else if amountSort === 'asc'}
								<ArrowUp class="h-3.5 w-3.5" />
							{:else}
								<ArrowUpDown class="h-3.5 w-3.5 text-gray-400" />
							{/if}
						</button>
					</th>
						<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-200">
					{#each visibleTransactions as tx}
						<tr class={editingId === tx.id ? 'bg-indigo-50/40' : ''}>
							<td class="px-4 py-3 align-top">
								<input
									type="checkbox"
									name="transaction_id"
									value={tx.id}
									form="transactions-delete-selected-form"
									bind:group={selectedForDelete}
									aria-label="Selecionar transação"
								/>
							</td>
							<td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900 align-top">{tx.date}</td>
							<td class="px-4 py-3 text-sm text-gray-900 align-top">
								<a href="/app/transactions/{tx.id}" class="hover:text-indigo-600">{tx.description}</a>
							</td>

							{#if editingId === tx.id}
								<td class="px-4 py-3 text-sm text-gray-600 align-top" colspan="2">
									<form
										method="POST"
										action="?/update_single_classification"
										use:enhance={({ submitter }) => keepScrollOnEditSubmit(tx.id, submitter)}
										data-sveltekit-noscroll
										class="flex flex-wrap items-end gap-2"
									>
										<input type="hidden" name="transaction_id" value={tx.id} />
										<input type="hidden" name="month" value={selectedMonth} />
										<input type="hidden" name="page" value={data.page} />
										<label class="min-w-44 text-xs font-medium text-gray-600">
											Categoria
											<select
												name="category_id"
												bind:value={editCategoryId}
												onchange={() => (editSubcategoryId = '')}
												class="mt-1 block w-44 rounded-md border-gray-300 shadow-sm text-sm px-2 py-1"
											>
												<option value="">Sem categoria</option>
												{#each parentCategories as cat}
													<option value={cat.id}>{cat.name}</option>
												{/each}
											</select>
										</label>
										<label class="min-w-44 text-xs font-medium text-gray-600">
											Subcategoria
											<select
												name="subcategory_id"
												bind:value={editSubcategoryId}
												disabled={!editCategoryId}
												class="mt-1 block w-44 rounded-md border-gray-300 shadow-sm text-sm px-2 py-1 disabled:bg-gray-100"
											>
												<option value="">Sem subcategoria</option>
												{#each editSubcategories as sub}
													<option value={sub.id}>{sub.name}</option>
												{/each}
											</select>
										</label>
										<label class="min-w-44 text-xs font-medium text-gray-600">
											Nova subcategoria
											<div class="mt-1 flex w-56 gap-1">
												<input
													name="new_subcategory_name"
													type="text"
													bind:value={newSubcategoryName}
													disabled={!editCategoryId || creatingSubcategoryForId === tx.id}
													placeholder="Criar aqui"
													class="block min-w-0 flex-1 rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm disabled:bg-gray-100"
												/>
												<button
													type="submit"
													formaction="?/create_subcategory"
													disabled={!editCategoryId || !newSubcategoryName.trim() || creatingSubcategoryForId === tx.id}
													class="inline-flex h-8 w-8 items-center justify-center rounded-md bg-green-600 text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
													title="Criar subcategoria"
													aria-label="Criar subcategoria"
												>
													<Plus class="h-4 w-4" />
												</button>
											</div>
										</label>
										<label class="min-w-44 text-xs font-medium text-gray-600">
											Atribuir a
											<select
												name="owner_profile_id"
												bind:value={editOwnerProfileId}
												class="mt-1 block w-44 rounded-md border-gray-300 shadow-sm text-sm px-2 py-1"
											>
												<option value="">Sem atribuição</option>
												{#each profiles as p}
													<option value={p.id}>{p.name}</option>
												{/each}
											</select>
										</label>
										<button
											type="submit"
											disabled={savingId === tx.id}
											class="inline-flex min-w-20 items-center justify-center px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
										>
											{savingId === tx.id ? 'Salvando...' : 'Salvar'}
										</button>
										<button
											type="button"
											onclick={cancelEdit}
											class="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
										>
											Cancelar
										</button>
									</form>
								</td>
							{:else}
								<td class="px-4 py-3 text-sm align-top">
									<button
										type="button"
										onclick={() => startEdit(tx)}
										class={`inline-flex max-w-sm flex-col items-start gap-0.5 rounded-md border px-2.5 py-1.5 text-left transition ${sourceClasses(tx)}`}
										aria-label="Editar classificação"
									>
										<span class="font-medium">{classificationText(tx)}</span>
										<span class="text-xs opacity-75">
											{subcategoryText(tx) || 'Sem subcategoria'}
											{#if tx.classification_display_source === 'suggestion'}
												<span aria-label="sugestão da classificação"> · sugerido</span>
											{/if}
										</span>
									</button>
								</td>
								<td class="px-4 py-3 text-sm text-gray-700 align-top">
									<button
										type="button"
										onclick={() => startEdit(tx)}
										class="inline-flex max-w-44 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-left text-gray-700 hover:bg-gray-100"
										aria-label="Editar atribuição"
									>
										{assignmentText(tx)}
									</button>
								</td>
							{/if}

							<td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right align-top">
								{tx.amount.toLocaleString('pt-BR', { style: 'currency', currency: tx.currency ?? 'BRL' })}
							</td>
							<td class="px-4 py-3 whitespace-nowrap text-sm align-top">
								{#if tx.review_status === 'needs_review'}
									<div class="flex items-center gap-2">
										<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">Revisar</span>
										<form method="POST" action="?/confirm_single" use:enhance={() => keepScrollOnConfirm(tx.id)} data-sveltekit-noscroll>
											<input type="hidden" name="transaction_id" value={tx.id} />
											<button
												type="submit"
												disabled={confirmingId === tx.id}
												class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
												title="Confirmar transação"
												aria-label="Confirmar transação"
											>
												<Check class="h-4 w-4" />
											</button>
										</form>
										<form method="POST" action="?/ignore_single" use:enhance={() => keepScrollOnStatusChange(tx.id)} data-sveltekit-noscroll>
											<input type="hidden" name="transaction_id" value={tx.id} />
											<button
												type="submit"
												disabled={statusChangingId === tx.id}
												class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-600 text-white shadow-sm hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
												title="Ignorar transação nos totais"
												aria-label="Ignorar transação nos totais"
											>
												<Ban class="h-4 w-4" />
											</button>
										</form>
									</div>
								{:else if tx.review_status === 'confirmed'}
									<div class="flex items-center gap-2">
										<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Confirmado</span>
										<form method="POST" action="?/ignore_single" use:enhance={() => keepScrollOnStatusChange(tx.id)} data-sveltekit-noscroll>
											<input type="hidden" name="transaction_id" value={tx.id} />
											<button
												type="submit"
												disabled={statusChangingId === tx.id}
												class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-600 text-white shadow-sm hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-300"
												title="Ignorar transação nos totais"
												aria-label="Ignorar transação nos totais"
											>
												<Ban class="h-4 w-4" />
											</button>
										</form>
									</div>
								{:else if tx.review_status === 'ignored'}
									<div class="flex items-center gap-2">
										<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">Ignorado</span>
										<form method="POST" action="?/restore_single" use:enhance={() => keepScrollOnStatusChange(tx.id)} data-sveltekit-noscroll>
											<input type="hidden" name="transaction_id" value={tx.id} />
											<button
												type="submit"
												disabled={statusChangingId === tx.id}
												class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm ring-1 ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
												title="Voltar para revisão"
												aria-label="Voltar para revisão"
											>
												<Undo2 class="h-4 w-4" />
											</button>
										</form>
									</div>
								{:else}
									<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">{tx.review_status}</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="flex items-center justify-between text-sm text-gray-600">
			<p>Página {data.page + 1}</p>
			<div class="flex gap-2">
				{#if data.page > 0}
					<a class="px-3 py-2 border rounded-md bg-white hover:bg-gray-50" href={`/app/transactions?month=${encodeURIComponent(selectedMonth)}&page=${data.page - 1}`}>Anterior</a>
				{/if}
				{#if data.hasMore}
					<a class="px-3 py-2 border rounded-md bg-white hover:bg-gray-50" href={`/app/transactions?month=${encodeURIComponent(selectedMonth)}&page=${data.page + 1}`}>Próxima</a>
				{/if}
			</div>
		</div>
	{/if}
</div>
