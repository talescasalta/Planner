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
	let filters = $derived(data.filters ?? { sourceType: 'all', categoryId: '', subcategoryId: '', status: 'all' });
	let summary = $derived(data.summary);
	let parentCategories = $derived(categories.filter((c) => !c.parent_id));
	let filterSubcategories = $derived(filters.categoryId ? categories.filter((c) => c.parent_id === filters.categoryId) : []);
	let selectedForDelete = $state<string[]>([]);
	let newSubcategoryName = $state('');
	// Per-row save state, keyed by transaction id, so saving one row never
	// unlocks another that is still in flight.
	let savingIds = $state<Record<string, boolean>>({});
	// Per-row error message shown when a row's auto-save is rejected by the server.
	let rowErrors = $state<Record<string, string>>({});
	let confirmingId = $state<string | null>(null);
	let statusChangingId = $state<string | null>(null);
	// Row currently showing the inline "create subcategory" input instead of the select.
	let creatingSubcategoryForId = $state<string | null>(null);

	let searchTerm = $state('');
	let amountSort = $state<'none' | 'desc' | 'asc'>('none');

	// Bulk-apply bar: '__keep__' means "leave this field untouched".
	const KEEP = '__keep__';
	// Sentinel option in the per-row subcategory select that opens the inline create input.
	const NEW_SUBCATEGORY = '__new__';
	let bulkCategoryId = $state(KEEP);
	let bulkSubcategoryId = $state('');
	let bulkOwnerId = $state(KEEP);
	let bulkApplying = $state(false);
	let bulkCategoryRealId = $derived(bulkCategoryId !== KEEP && bulkCategoryId !== '' ? bulkCategoryId : '');
	let bulkSubcategories = $derived(bulkCategoryRealId ? categories.filter((c) => c.parent_id === bulkCategoryRealId) : []);
	let bulkHasChange = $derived(bulkCategoryId !== KEEP || bulkOwnerId !== KEEP);

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
		if (bulkSubcategoryId && !bulkSubcategories.some((sub) => sub.id === bulkSubcategoryId)) {
			bulkSubcategoryId = '';
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
		return transactionsHref({ month, page: 0 });
	}

	function transactionsHref(overrides: {
		month?: string;
		sourceType?: string;
		categoryId?: string;
		subcategoryId?: string;
		status?: string;
		page?: number;
	} = {}) {
		const params = new URLSearchParams();
		const month = overrides.month ?? selectedMonth;
		const sourceType = overrides.sourceType ?? filters.sourceType;
		const categoryId = overrides.categoryId ?? filters.categoryId;
		const subcategoryId = overrides.subcategoryId ?? filters.subcategoryId;
		const status = overrides.status ?? filters.status;
		const page = overrides.page ?? data.page;

		if (month) params.set('month', month);
		if (sourceType && sourceType !== 'all') params.set('source_type', sourceType);
		if (categoryId) params.set('category_id', categoryId);
		if (subcategoryId) params.set('subcategory_id', subcategoryId);
		if (status && status !== 'all') params.set('status', status);
		if (page > 0) params.set('page', String(page));

		const query = params.toString();
		return `/app/transactions${query ? `?${query}` : ''}`;
	}

	function hasActiveFilters() {
		return (
			(filters.sourceType && filters.sourceType !== 'all') ||
			!!filters.categoryId ||
			!!filters.subcategoryId ||
			(filters.status && filters.status !== 'all')
		);
	}

	function sourceTypeText(value: string | null | undefined) {
		if (value === 'credit_card') return 'Fatura de cartão';
		if (value === 'bank_account') return 'Conta corrente';
		if (value === 'vale_alimentacao') return 'Vale alimentação';
		if (value === 'vale_refeicao') return 'Vale refeição';
		return 'Sem origem definida';
	}

	function setAllVisible(checked: boolean) {
		selectedForDelete = checked ? visibleTransactions.map((tx) => tx.id) : [];
	}

	function rowSubcategories(categoryId: string | null | undefined) {
		return categoryId ? categories.filter((c) => c.parent_id === categoryId) : [];
	}

	function suggestionLabel(tx: Transaction): string | null {
		if (tx.classification_display_source !== 'suggestion') return null;
		const category = tx.category_display_name ?? '';
		const subcategory = tx.subcategory_display_name;
		return subcategory ? `${category} · ${subcategory}` : category;
	}

	// Spreadsheet-style rows: every select saves its row immediately on change.
	function submitRowForm(event: Event) {
		(event.currentTarget as HTMLSelectElement).form?.requestSubmit();
	}

	function onRowCategoryChange(event: Event) {
		const target = event.currentTarget as HTMLSelectElement;
		const form = target.form;
		if (!form) return;
		// The old subcategory no longer belongs to the new category; clear it
		// before saving so the server does not reject the pair.
		const sub = form.elements.namedItem('subcategory_id');
		if (sub instanceof HTMLSelectElement || sub instanceof HTMLInputElement) sub.value = '';
		form.requestSubmit();
	}

	function onRowSubcategoryChange(event: Event, transactionId: string) {
		const target = event.currentTarget as HTMLSelectElement;
		if (target.value === NEW_SUBCATEGORY) {
			creatingSubcategoryForId = transactionId;
			newSubcategoryName = '';
			return;
		}
		target.form?.requestSubmit();
	}

	function cancelCreateSubcategory() {
		creatingSubcategoryForId = null;
		newSubcategoryName = '';
	}

	// A rejected change leaves the native select showing the value the user
	// picked; snap the row's controls back to what is actually stored.
	function revertRowControls(formElement: HTMLFormElement, tx: Transaction) {
		const set = (name: string, value: string) => {
			const el = formElement.elements.namedItem(name);
			if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement) el.value = value;
		};
		set('category_id', tx.category_id ?? '');
		set('subcategory_id', tx.subcategory_id ?? '');
		set('owner_profile_id', tx.owner_profile_id ?? '');
	}

	function rowEnhance(tx: Transaction, formElement: HTMLFormElement, submitter: HTMLElement | null) {
		const scrollY = window.scrollY;
		const isCreatingSubcategory =
			submitter instanceof HTMLButtonElement && submitter.formAction.includes('create_subcategory');
		savingIds[tx.id] = true;
		delete rowErrors[tx.id];

		return async ({
			result,
			update
		}: {
			result: { type: string; data?: Record<string, unknown> };
			update: () => Promise<void>;
		}) => {
			if (result.type === 'failure') {
				// Don't reload (nothing changed server-side); revert and surface the error.
				revertRowControls(formElement, tx);
				const message = result.data?.message;
				rowErrors[tx.id] = typeof message === 'string' ? message : 'Não foi possível salvar. Tente novamente.';
				delete savingIds[tx.id];
				requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
				return;
			}
			await update();
			requestAnimationFrame(() => {
				window.scrollTo({ top: scrollY });
				delete savingIds[tx.id];
				if (isCreatingSubcategory && result.type === 'success') cancelCreateSubcategory();
			});
		};
	}

	function bulkApplyEnhance() {
		const scrollY = window.scrollY;
		bulkApplying = true;

		return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
			await update();
			bulkApplying = false;
			if (result.type === 'success') {
				selectedForDelete = [];
				bulkCategoryId = KEEP;
				bulkSubcategoryId = '';
				bulkOwnerId = KEEP;
			}
			requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
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

		<div class="grid gap-3 md:grid-cols-5">
			<div>
				<label for="source-type-filter" class="block text-xs font-medium uppercase tracking-wider text-gray-500">Origem</label>
				<select
					id="source-type-filter"
					class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
					value={filters.sourceType}
					onchange={(event) => {
						window.location.href = transactionsHref({ sourceType: event.currentTarget.value, page: 0 });
					}}
				>
					<option value="all">Todas</option>
					<option value="credit_card">Fatura de cartão</option>
					<option value="bank_account">Conta corrente</option>
					<option value="vale_alimentacao">Vale alimentação</option>
					<option value="vale_refeicao">Vale refeição</option>
					<option value="unknown">Sem origem definida</option>
				</select>
			</div>

			<div>
				<label for="category-filter" class="block text-xs font-medium uppercase tracking-wider text-gray-500">Categoria</label>
				<select
					id="category-filter"
					class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
					value={filters.categoryId}
					onchange={(event) => {
						window.location.href = transactionsHref({
							categoryId: event.currentTarget.value,
							subcategoryId: '',
							page: 0
						});
					}}
				>
					<option value="">Todas</option>
					{#each parentCategories as cat}
						<option value={cat.id}>{cat.name}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="subcategory-filter" class="block text-xs font-medium uppercase tracking-wider text-gray-500">Subcategoria</label>
				<select
					id="subcategory-filter"
					class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-100"
					value={filters.subcategoryId}
					disabled={!filters.categoryId}
					onchange={(event) => {
						window.location.href = transactionsHref({ subcategoryId: event.currentTarget.value, page: 0 });
					}}
				>
					<option value="">Todas</option>
					{#each filterSubcategories as sub}
						<option value={sub.id}>{sub.name}</option>
					{/each}
				</select>
			</div>

			<div>
				<label for="status-filter" class="block text-xs font-medium uppercase tracking-wider text-gray-500">Status</label>
				<select
					id="status-filter"
					class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
					value={filters.status}
					onchange={(event) => {
						window.location.href = transactionsHref({ status: event.currentTarget.value, page: 0 });
					}}
				>
					<option value="all">Todos</option>
					<option value="needs_review">Revisar</option>
					<option value="confirmed">Confirmado</option>
					<option value="ignored">Ignorado</option>
				</select>
			</div>

			<div class="flex items-end">
				<a
					href={transactionsHref({
						sourceType: 'all',
						categoryId: '',
						subcategoryId: '',
						status: 'all',
						page: 0
					})}
					class={`inline-flex w-full justify-center rounded-md border px-3 py-2 text-sm font-medium ${
						hasActiveFilters()
							? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
							: 'pointer-events-none border-gray-200 bg-gray-50 text-gray-400'
					}`}
				>
					Limpar filtros
				</a>
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
				<input type="hidden" name="source_type_filter" value={filters.sourceType} />
				<input type="hidden" name="category_id_filter" value={filters.categoryId} />
				<input type="hidden" name="subcategory_id_filter" value={filters.subcategoryId} />
				<input type="hidden" name="status_filter" value={filters.status} />
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
			{#each selectedForDelete as id}
				<input type="hidden" name="transaction_id" value={id} />
			{/each}
			<input type="hidden" name="month" value={selectedMonth} />
			<input type="hidden" name="page" value={data.page} />
			<input type="hidden" name="source_type_filter" value={filters.sourceType} />
			<input type="hidden" name="category_id_filter" value={filters.categoryId} />
			<input type="hidden" name="subcategory_id_filter" value={filters.subcategoryId} />
			<input type="hidden" name="status_filter" value={filters.status} />
		</form>

		<div class="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm lg:flex-row lg:items-end lg:justify-between">
			<div class="flex items-center gap-3">
				<p class="text-sm font-medium text-gray-700">{selectedForDelete.length} selecionadas</p>
				{#if selectedForDelete.length > 0}
					<button type="button" onclick={() => (selectedForDelete = [])} class="text-xs text-gray-500 underline hover:text-gray-700">
						limpar seleção
					</button>
				{/if}
			</div>

			{#if selectedForDelete.length > 0}
				<form
					method="POST"
					action="?/bulk_apply_classification"
					use:enhance={bulkApplyEnhance}
					data-sveltekit-noscroll
					class="flex flex-wrap items-end gap-2"
				>
					{#each selectedForDelete as id}
						<input type="hidden" name="transaction_id" value={id} />
					{/each}
					<label class="text-xs font-medium text-gray-600">
						Categoria
						<select
							name="category_id"
							bind:value={bulkCategoryId}
							onchange={() => (bulkSubcategoryId = '')}
							class="mt-1 block w-40 rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm"
						>
							<option value={KEEP}>— manter —</option>
							<option value="">Sem categoria</option>
							{#each parentCategories as cat}
								<option value={cat.id}>{cat.name}</option>
							{/each}
						</select>
					</label>
					<label class="text-xs font-medium text-gray-600">
						Subcategoria
						<select
							name="subcategory_id"
							bind:value={bulkSubcategoryId}
							disabled={!bulkCategoryRealId}
							class="mt-1 block w-40 rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm disabled:bg-gray-100"
						>
							<option value="">Sem subcategoria</option>
							{#each bulkSubcategories as sub}
								<option value={sub.id}>{sub.name}</option>
							{/each}
						</select>
					</label>
					<label class="text-xs font-medium text-gray-600">
						Atribuir a
						<select
							name="owner_profile_id"
							bind:value={bulkOwnerId}
							class="mt-1 block w-40 rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm"
						>
							<option value={KEEP}>— manter —</option>
							<option value="">Sem atribuição</option>
							{#each profiles as p}
								<option value={p.id}>{p.name}</option>
							{/each}
						</select>
					</label>
					<button
						type="submit"
						disabled={!bulkHasChange || bulkApplying}
						class="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
					>
						{bulkApplying ? 'Aplicando...' : `Aplicar a ${selectedForDelete.length}`}
					</button>
				</form>
			{/if}

			<button
				type="submit"
				form="transactions-delete-selected-form"
				disabled={selectedForDelete.length === 0}
				class="self-start px-3 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-50 disabled:hover:bg-red-50 lg:self-auto"
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
						<th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Origem</th>
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
					{#each visibleTransactions as tx (tx.id)}
						<tr class={savingIds[tx.id] ? 'bg-indigo-50/40' : ''}>
							<td class="px-4 py-3 align-top">
								<input
									type="checkbox"
									value={tx.id}
									bind:group={selectedForDelete}
									aria-label="Selecionar transação"
								/>
							</td>
							<td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900 align-top">{tx.date}</td>
							<td class="px-4 py-3 text-sm text-gray-900 align-top">
								<a href="/app/transactions/{tx.id}" class="hover:text-indigo-600">{tx.description}</a>
							</td>
							<td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700 align-top">
								<span class="inline-flex rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
									{sourceTypeText(tx.source_type)}
								</span>
							</td>

							<td class="px-4 py-3 text-sm align-top">
								<!-- Hidden per-row form; the selects in this row associate via form= and
								     auto-save on change, spreadsheet style. -->
								<form
									id={`tx-form-${tx.id}`}
									method="POST"
									action="?/update_single_classification"
									use:enhance={({ formElement, submitter }) => rowEnhance(tx, formElement, submitter)}
									data-sveltekit-noscroll
								>
									<input type="hidden" name="transaction_id" value={tx.id} />
									<input type="hidden" name="month" value={selectedMonth} />
									<input type="hidden" name="page" value={data.page} />
									<input type="hidden" name="source_type_filter" value={filters.sourceType} />
									<input type="hidden" name="category_id_filter" value={filters.categoryId} />
									<input type="hidden" name="subcategory_id_filter" value={filters.subcategoryId} />
									<input type="hidden" name="status_filter" value={filters.status} />
								</form>
								<div class="flex flex-col gap-1">
									<select
										name="category_id"
										form={`tx-form-${tx.id}`}
										value={tx.category_id ?? ''}
										disabled={savingIds[tx.id]}
										onchange={onRowCategoryChange}
										aria-label="Categoria"
										class="block w-40 rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm disabled:bg-gray-100"
									>
										<option value="">Sem categoria</option>
										{#each parentCategories as cat}
											<option value={cat.id}>{cat.name}</option>
										{/each}
									</select>
									{#if creatingSubcategoryForId === tx.id}
										<div class="flex w-40 gap-1">
											<input type="hidden" name="subcategory_id" value={tx.subcategory_id ?? ''} form={`tx-form-${tx.id}`} />
											<input
												name="new_subcategory_name"
												form={`tx-form-${tx.id}`}
												type="text"
												bind:value={newSubcategoryName}
												placeholder="Nova subcategoria"
												class="block min-w-0 flex-1 rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm"
											/>
											<button
												type="submit"
												form={`tx-form-${tx.id}`}
												formaction="?/create_subcategory"
												disabled={!newSubcategoryName.trim() || savingIds[tx.id]}
												class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-green-600 text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
												title="Criar subcategoria"
												aria-label="Criar subcategoria"
											>
												<Plus class="h-4 w-4" />
											</button>
											<button
												type="button"
												onclick={cancelCreateSubcategory}
												class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
												title="Cancelar"
												aria-label="Cancelar criação de subcategoria"
											>
												<X class="h-4 w-4" />
											</button>
										</div>
									{:else}
										<select
											name="subcategory_id"
											form={`tx-form-${tx.id}`}
											value={tx.subcategory_id ?? ''}
											disabled={savingIds[tx.id] || !tx.category_id}
											onchange={(event) => onRowSubcategoryChange(event, tx.id)}
											aria-label="Subcategoria"
											class="block w-40 rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm disabled:bg-gray-100"
										>
											<option value="">Sem subcategoria</option>
											{#each rowSubcategories(tx.category_id) as sub}
												<option value={sub.id}>{sub.name}</option>
											{/each}
											{#if tx.category_id}
												<option value={NEW_SUBCATEGORY}>+ Criar nova…</option>
											{/if}
										</select>
									{/if}
									{#if suggestionLabel(tx)}
										<span class="w-40 text-xs text-amber-700">sugerido: {suggestionLabel(tx)}</span>
									{/if}
									{#if rowErrors[tx.id]}
										<span class="w-40 text-xs text-red-600" role="alert">{rowErrors[tx.id]}</span>
									{/if}
								</div>
							</td>
							<td class="px-4 py-3 text-sm align-top">
								<select
									name="owner_profile_id"
									form={`tx-form-${tx.id}`}
									value={tx.owner_profile_id ?? ''}
									disabled={savingIds[tx.id]}
									onchange={submitRowForm}
									aria-label="Atribuir a"
									class="block w-40 rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm disabled:bg-gray-100"
								>
									<option value="">Sem atribuição</option>
									{#each profiles as p}
										<option value={p.id}>{p.name}</option>
									{/each}
								</select>
							</td>

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
					<a class="px-3 py-2 border rounded-md bg-white hover:bg-gray-50" href={transactionsHref({ page: data.page - 1 })}>Anterior</a>
				{/if}
				{#if data.hasMore}
					<a class="px-3 py-2 border rounded-md bg-white hover:bg-gray-50" href={transactionsHref({ page: data.page + 1 })}>Próxima</a>
				{/if}
			</div>
		</div>
	{/if}
</div>
