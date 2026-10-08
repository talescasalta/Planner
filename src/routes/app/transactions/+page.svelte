<script lang="ts">
	import { brl, formatMonthLong, money } from '$lib/format';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		ArrowDown,
		ArrowLeftRight,
		ArrowUp,
		ArrowUpDown,
		Plus,
		Search,
		SlidersHorizontal,
		X
	} from 'lucide-svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import TransactionStatusActions from '$lib/components/transactions/TransactionStatusActions.svelte';
	import type { TransactionsPageData } from '$lib/types/page-data';
	import type { ClassificationSuggestion, Transaction } from '$lib/types/app';
	import { TREATMENT_OPTIONS, flowKindLabel } from '$lib/financial-labels';

	let { data }: { data: TransactionsPageData } = $props();
	let transactions = $derived(data.transactions ?? []);
	let categories = $derived(data.categories ?? []);
	let profiles = $derived(data.profiles ?? []);
	let accounts = $derived(data.accounts ?? []);
	let monthOptions = $derived(data.monthOptions ?? []);
	let selectedMonth = $derived(data.selectedMonth ?? '');
	let filters = $derived(
		data.filters ?? {
			sourceType: 'all',
			profileId: '',
			categoryId: '',
			subcategoryId: '',
			status: 'all',
			direction: 'all',
			flow: 'all'
		}
	);
	let summary = $derived(data.summary);
	let parentCategories = $derived(categories.filter((c) => !c.parent_id));
	let filterSubcategories = $derived(
		filters.categoryId
			? categories.filter((c) => c.parent_id === filters.categoryId)
			: []
	);
	let selectedForDelete = $state<string[]>([]);
	let newSubcategoryName = $state('');
	// Per-row save state, keyed by transaction id, so saving one row never
	// unlocks another that is still in flight.
	let savingIds = $state<Record<string, boolean>>({});
	// Per-row error message shown when a row's auto-save is rejected by the server.
	let rowErrors = $state<Record<string, string>>({});
	let statusChangingId = $state<string | null>(null);
	// Row currently showing the inline "create subcategory" input instead of the select.
	let creatingSubcategoryForId = $state<string | null>(null);

	// Below sm the bulk bar pins above the bottom navigation while rows are selected.
	const BULK_BAR_FIXED =
		'fixed inset-x-0 bottom-16 z-20 max-h-[60vh] overflow-y-auto rounded-none border-x-0 shadow-lg sm:static sm:max-h-none sm:overflow-visible sm:rounded-lg sm:border-x sm:shadow-sm';

	let filtersOpen = $state(false);
	let searchTerm = $state('');
	let amountSort = $state<'none' | 'desc' | 'asc'>('none');

	// Rows edited in place that stopped matching the active filters after the
	// save (e.g. categorized while filtering by "a revisar", or moved to
	// another category while filtering by category). They stay visible at
	// their original position until the user navigates to another view, so
	// the row being worked on never vanishes mid-edit.
	let retainedRows = $state<Array<{ tx: Transaction; index: number }>>([]);
	// Only rows actually re-inserted (absent from the fresh list) get the
	// dimmed "fora do filtro" treatment; a retained row that reappears in the
	// server list renders as a normal row.
	let displayedRetainedIds = $derived.by(() => {
		if (retainedRows.length === 0) return new Set<string>();
		const present = new Set(transactions.map((t) => t.id));
		return new Set(
			retainedRows.filter((r) => !present.has(r.tx.id)).map((r) => r.tx.id)
		);
	});
	// Retained rows belong to the view they were edited in; navigating to a
	// different month/filter/page drops them (a same-view reload after a row
	// save keeps the key identical, so they survive exactly as intended).
	let viewKey = $derived(
		[
			selectedMonth,
			filters.sourceType,
			filters.account,
			filters.profileId,
			filters.categoryId,
			filters.subcategoryId,
			filters.status,
			filters.direction,
			filters.flow,
			data.page
		].join('|')
	);
	let retainedViewKey = $state<string | null>(null);
	$effect(() => {
		if (retainedViewKey !== viewKey) {
			retainedViewKey = viewKey;
			retainedRows = [];
		}
	});

	// After a save, keep the row visible in place when it fell out of the
	// active filters; drop any stale copy when it is still (or again) listed.
	function retainAfterSave(
		tx: Transaction,
		previousIndex: number,
		overrides: Partial<Transaction>
	) {
		if (transactions.some((t) => t.id === tx.id)) {
			retainedRows = retainedRows.filter((r) => r.tx.id !== tx.id);
			return;
		}
		const existing = retainedRows.find((r) => r.tx.id === tx.id);
		retainedRows = [
			...retainedRows.filter((r) => r.tx.id !== tx.id),
			{
				tx: { ...tx, ...overrides },
				index: previousIndex >= 0 ? previousIndex : (existing?.index ?? 0)
			}
		];
	}

	// Bulk-apply bar: '__keep__' means "leave this field untouched".
	const KEEP = '__keep__';
	// Sentinel option in the per-row subcategory select that opens the inline create input.
	const NEW_SUBCATEGORY = '__new__';
	let bulkCategoryId = $state(KEEP);
	let bulkSubcategoryId = $state('');
	let bulkOwnerId = $state(KEEP);
	let bulkTreatment = $state(KEEP);
	let bulkApplying = $state(false);
	let bulkCategoryRealId = $derived(
		bulkCategoryId !== KEEP && bulkCategoryId !== '' ? bulkCategoryId : ''
	);
	let bulkSubcategories = $derived(
		bulkCategoryRealId
			? categories.filter((c) => c.parent_id === bulkCategoryRealId)
			: []
	);
	let bulkHasChange = $derived(
		bulkCategoryId !== KEEP || bulkOwnerId !== KEEP || bulkTreatment !== KEEP
	);

	let visibleTransactions = $derived.by(() => {
		const term = searchTerm.trim().toLowerCase();
		let list = transactions;
		if (retainedRows.length > 0) {
			const toInsert = retainedRows.filter((r) =>
				displayedRetainedIds.has(r.tx.id)
			);
			if (toInsert.length > 0) {
				list = [...list];
				for (const r of toInsert)
					list.splice(Math.min(r.index, list.length), 0, r.tx);
			}
		}
		if (term) {
			list = list.filter((tx) => {
				const desc = (tx.description ?? '').toLowerCase();
				const clean = (tx.clean_description ?? '').toLowerCase();
				const cat = (tx.category_display_name ?? '').toLowerCase();
				const sub = (tx.subcategory_display_name ?? '').toLowerCase();
				return (
					desc.includes(term) ||
					clean.includes(term) ||
					cat.includes(term) ||
					sub.includes(term)
				);
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
		amountSort =
			amountSort === 'none' ? 'desc' : amountSort === 'desc' ? 'asc' : 'none';
	}

	$effect(() => {
		if (
			bulkSubcategoryId &&
			!bulkSubcategories.some((sub) => sub.id === bulkSubcategoryId)
		) {
			bulkSubcategoryId = '';
		}
	});

	function monthHref(month: string) {
		return transactionsHref({ month, page: 0 });
	}

	function setQueryParam(
		params: URLSearchParams,
		key: string,
		value: string,
		ignored = ''
	) {
		if (value && value !== ignored) params.set(key, value);
	}

	function transactionsHref(
		overrides: {
			month?: string;
			sourceType?: string;
			account?: string;
			categoryId?: string;
			subcategoryId?: string;
			status?: string;
			direction?: string;
			flow?: string;
			page?: number;
		} = {}
	) {
		const params = new SvelteURLSearchParams();
		// Whatever the caller does not name keeps the current view's value.
		const view = {
			month: selectedMonth,
			sourceType: filters.sourceType,
			account: filters.account,
			categoryId: filters.categoryId,
			subcategoryId: filters.subcategoryId,
			status: filters.status,
			direction: filters.direction,
			flow: filters.flow,
			page: data.page,
			...overrides
		};

		setQueryParam(params, 'month', view.month);
		setQueryParam(params, 'source_type', view.sourceType, 'all');
		setQueryParam(params, 'account', view.account, 'all');
		setQueryParam(params, 'profile_id', filters.profileId);
		setQueryParam(params, 'category_id', view.categoryId);
		setQueryParam(params, 'subcategory_id', view.subcategoryId);
		setQueryParam(params, 'status', view.status, 'all');
		setQueryParam(params, 'direction', view.direction, 'all');
		setQueryParam(params, 'flow', view.flow, 'all');
		if (view.page > 0) params.set('page', String(view.page));

		const query = params.toString();
		return `/app/transactions${query ? `?${query}` : ''}`;
	}

	function activeFilterCount() {
		const selectors = [
			filters.sourceType,
			filters.account,
			filters.status,
			filters.direction,
			filters.flow
		];
		const pickers = [
			filters.profileId,
			filters.categoryId,
			filters.subcategoryId
		];
		return (
			selectors.filter((value) => value && value !== 'all').length +
			pickers.filter(Boolean).length
		);
	}

	function hasActiveFilters() {
		return activeFilterCount() > 0;
	}

	function filtersButtonLabel() {
		const count = activeFilterCount();
		return count > 0 ? `Filtros (${count})` : 'Filtros';
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
		return categoryId
			? categories.filter((c) => c.parent_id === categoryId)
			: [];
	}

	function duplicateNote(
		tx: Transaction,
		suggestion: ClassificationSuggestion
	): string | null {
		if (
			tx.review_status !== 'ignored' ||
			!('duplicate_description' in suggestion)
		) {
			return null;
		}
		return `Possível duplicata de "${suggestion.duplicate_description}" (${suggestion.duplicate_date})`;
	}

	function transferPairNote(
		tx: Transaction,
		suggestion: ClassificationSuggestion
	): string | null {
		if (
			tx.review_status !== 'needs_review' ||
			!('pair_description' in suggestion)
		) {
			return null;
		}
		const account = suggestion.pair_account
			? ` em ${suggestion.pair_account}`
			: '';
		return `Parece transferência entre contas (par: "${suggestion.pair_description}"${account})`;
	}

	// Why an import or a classification left a row ignored or in review: a
	// repeat of another source, one side of a transfer between the household's
	// own accounts, or the proceeds of an investment redemption.
	function reviewNote(tx: Transaction): string | null {
		const suggestion = tx.classification_suggestion;
		if (!suggestion || !('reason_code' in suggestion)) return null;
		switch (suggestion.reason_code) {
			case 'possible_duplicate':
				return duplicateNote(tx, suggestion);
			case 'transfer_pair':
				return transferPairNote(tx, suggestion);
			case 'b3_redemption_nearby':
				return tx.review_status === 'needs_review'
					? 'Parece resgate de investimento: há um resgate na B3 nos últimos dias'
					: null;
			default:
				return null;
		}
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
		if (sub instanceof HTMLSelectElement || sub instanceof HTMLInputElement)
			sub.value = '';
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
			if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement)
				el.value = value;
		};
		set('category_id', tx.category_id ?? '');
		set('subcategory_id', tx.subcategory_id ?? '');
		set('owner_profile_id', tx.owner_profile_id ?? '');
		set('financial_treatment_override', tx.financial_treatment_override ?? '');
	}

	function rowEnhance(
		tx: Transaction,
		formElement: HTMLFormElement,
		submitter: HTMLElement | null
	) {
		const scrollY = window.scrollY;
		const isCreatingSubcategory =
			submitter instanceof HTMLButtonElement &&
			submitter.formAction.includes('create_subcategory');
		savingIds[tx.id] = true;
		delete rowErrors[tx.id];

		// Snapshot what was submitted while the form still exists in the DOM:
		// after update() the row may have been filtered out and unmounted.
		const readControl = (name: string) => {
			const el = formElement.elements.namedItem(name);
			return el instanceof HTMLSelectElement || el instanceof HTMLInputElement
				? el.value
				: '';
		};
		const submittedCategoryId = readControl('category_id') || null;
		const submittedSubcategoryId = readControl('subcategory_id') || null;
		const submittedOwnerId = readControl('owner_profile_id') || null;
		const submittedTreatment =
			readControl('financial_treatment_override') || null;
		const previousIndex = transactions.findIndex((t) => t.id === tx.id);

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
				rowErrors[tx.id] =
					typeof message === 'string'
						? message
						: 'Não foi possível salvar. Tente novamente.';
				delete savingIds[tx.id];
				requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
				return;
			}
			await update();
			// If the save pushed the row out of the active filters (e.g. it was
			// confirmed while filtering by "a revisar"), keep an updated copy in
			// place instead of letting it vanish from under the user.
			if (result.type === 'success') {
				retainAfterSave(tx, previousIndex, {
					category_id: submittedCategoryId,
					subcategory_id: submittedSubcategoryId,
					owner_profile_id: submittedOwnerId,
					financial_treatment_override: submittedTreatment as
						'operating' | 'investment' | 'transfer' | null,
					review_status: 'confirmed',
					classification_display_source: 'saved',
					category_display_name:
						categories.find((c) => c.id === submittedCategoryId)?.name ?? null,
					subcategory_display_name:
						categories.find((c) => c.id === submittedSubcategoryId)?.name ??
						null
				});
			}
			requestAnimationFrame(() => {
				window.scrollTo({ top: scrollY });
				delete savingIds[tx.id];
				if (isCreatingSubcategory && result.type === 'success')
					cancelCreateSubcategory();
			});
		};
	}

	function bulkApplyEnhance() {
		const scrollY = window.scrollY;
		bulkApplying = true;

		return async ({
			result,
			update
		}: {
			result: { type: string };
			update: () => Promise<void>;
		}) => {
			await update();
			bulkApplying = false;
			if (result.type === 'success') {
				// Retained snapshots of bulk-edited rows are stale now; drop them.
				retainedRows = retainedRows.filter(
					(r) => !selectedForDelete.includes(r.tx.id)
				);
				selectedForDelete = [];
				bulkCategoryId = KEEP;
				bulkSubcategoryId = '';
				bulkOwnerId = KEEP;
				bulkTreatment = KEEP;
			}
			requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
		};
	}

	function keepScrollOnStatusChange(
		tx: Transaction,
		nextStatus: Transaction['review_status']
	) {
		const scrollY = window.scrollY;
		statusChangingId = tx.id;
		const previousIndex = transactions.findIndex((t) => t.id === tx.id);

		return async ({
			result,
			update
		}: {
			result: { type: string };
			update: () => Promise<void>;
		}) => {
			await update();
			if (result.type === 'success') {
				retainAfterSave(tx, previousIndex, { review_status: nextStatus });
			}
			requestAnimationFrame(() => {
				window.scrollTo({ top: scrollY });
				statusChangingId = null;
			});
		};
	}
</script>

<div class="space-y-4">
	<div
		class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
	>
		<h2 class="text-xl font-semibold text-gray-900">Transações</h2>
		<a
			href={resolve('/app/transactions/new')}
			class="inline-flex items-center self-start px-3 py-2 border border-gray-300 text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 lg:self-auto"
		>
			Nova transação
		</a>
	</div>

	<div class="bg-white shadow rounded-lg p-4 space-y-4">
		<div
			class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
		>
			<div class="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
				<div>
					<label
						for="month-filter"
						class="block text-xs font-medium uppercase tracking-wider text-gray-500"
						>Mês da fatura</label
					>
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
						{#each monthOptions as month (month)}
							<option value={month}>{formatMonthLong(month)}</option>
						{/each}
					</select>
				</div>

				<div class="flex-1">
					<label
						for="tx-search"
						class="block text-xs font-medium uppercase tracking-wider text-gray-500"
						>Buscar</label
					>
					<div class="relative mt-1">
						<Search
							class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
						/>
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

			<div class="grid grid-cols-2 md:grid-cols-8 gap-3 text-sm">
				<div>
					<p class="text-xs text-gray-500">Transações</p>
					<p class="font-semibold text-gray-900">{summary.count}</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Despesas</p>
					<p class="font-semibold text-red-700">
						{brl(summary.expenses)}
					</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Créditos</p>
					<p class="font-semibold text-green-700">
						{brl(summary.credits)}
					</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Saldo</p>
					<p class="font-semibold text-gray-900">
						{brl(summary.balance)}
					</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Aportes</p>
					<p class="font-semibold text-amber-700">
						{brl(summary.contributions)}
					</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Resgates</p>
					<p class="font-semibold text-emerald-700">
						{brl(summary.redemptions)}
					</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Proventos</p>
					<p class="font-semibold text-emerald-700">
						{brl(summary.investmentIncome)}
					</p>
				</div>
				<div>
					<p class="text-xs text-gray-500">Transferências</p>
					<p class="font-semibold text-sky-700">
						{brl(summary.transfers)}
					</p>
				</div>
			</div>
		</div>

		<div class="hidden gap-3 sm:grid md:grid-cols-4 xl:grid-cols-7">
			{@render filterFields('')}
		</div>
		<button
			type="button"
			class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:hidden"
			onclick={() => (filtersOpen = true)}
		>
			<SlidersHorizontal class="h-4 w-4" />
			{filtersButtonLabel()}
		</button>

		{#if selectedMonth && selectedMonth !== 'all' && summary.count > 0}
			<form
				method="POST"
				action="?/delete_month"
				onsubmit={(event) => {
					if (
						!confirm(
							`Excluir todas as transações de ${formatMonthLong(selectedMonth)}?`
						)
					)
						event.preventDefault();
				}}
				class="flex justify-end"
			>
				<input type="hidden" name="reference_month" value={selectedMonth} />
				<input
					type="hidden"
					name="source_type_filter"
					value={filters.sourceType}
				/>
				<input type="hidden" name="account_filter" value={filters.account} />
				<input
					type="hidden"
					name="profile_id_filter"
					value={filters.profileId}
				/>
				<input
					type="hidden"
					name="category_id_filter"
					value={filters.categoryId}
				/>
				<input
					type="hidden"
					name="subcategory_id_filter"
					value={filters.subcategoryId}
				/>
				<input type="hidden" name="status_filter" value={filters.status} />
				<input
					type="hidden"
					name="direction_filter"
					value={filters.direction}
				/>
				<input type="hidden" name="flow_filter" value={filters.flow} />
				<button
					type="submit"
					class="px-3 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100"
				>
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
				if (
					!confirm(
						`Excluir ${selectedForDelete.length} transações selecionadas?`
					)
				)
					event.preventDefault();
			}}
		>
			{#each selectedForDelete as id (id)}
				<input type="hidden" name="transaction_id" value={id} />
			{/each}
			<input type="hidden" name="month" value={selectedMonth} />
			<input type="hidden" name="page" value={data.page} />
			<input type="hidden" name="profile_id_filter" value={filters.profileId} />
			<input
				type="hidden"
				name="source_type_filter"
				value={filters.sourceType}
			/>
			<input type="hidden" name="account_filter" value={filters.account} />
			<input
				type="hidden"
				name="category_id_filter"
				value={filters.categoryId}
			/>
			<input
				type="hidden"
				name="subcategory_id_filter"
				value={filters.subcategoryId}
			/>
			<input type="hidden" name="status_filter" value={filters.status} />
			<input type="hidden" name="direction_filter" value={filters.direction} />
			<input type="hidden" name="flow_filter" value={filters.flow} />
		</form>

		<div
			class="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm lg:flex-row lg:items-end lg:justify-between {selectedForDelete.length >
			0
				? BULK_BAR_FIXED
				: ''}"
		>
			<div class="flex items-center gap-3">
				<p class="text-sm font-medium text-gray-700">
					{selectedForDelete.length} selecionadas
				</p>
				{#if selectedForDelete.length > 0}
					<button
						type="button"
						onclick={() => (selectedForDelete = [])}
						class="text-xs text-gray-500 underline hover:text-gray-700"
					>
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
					class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
				>
					{#each selectedForDelete as id (id)}
						<input type="hidden" name="transaction_id" value={id} />
					{/each}
					<label class="text-xs font-medium text-gray-600">
						Categoria
						<select
							name="category_id"
							bind:value={bulkCategoryId}
							onchange={() => (bulkSubcategoryId = '')}
							class="mt-1 block w-full rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm sm:w-40"
						>
							<option value={KEEP}>— manter —</option>
							<option value="">Sem categoria</option>
							{#each parentCategories as cat (cat.id)}
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
							class="mt-1 block w-full rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm sm:w-40 disabled:bg-gray-100"
						>
							<option value="">Sem subcategoria</option>
							{#each bulkSubcategories as sub (sub.id)}
								<option value={sub.id}>{sub.name}</option>
							{/each}
						</select>
					</label>
					<label class="text-xs font-medium text-gray-600">
						Atribuir a
						<select
							name="owner_profile_id"
							bind:value={bulkOwnerId}
							class="mt-1 block w-full rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm sm:w-40"
						>
							<option value={KEEP}>— manter —</option>
							<option value="">Sem atribuição</option>
							{#each profiles as p (p.id)}
								<option value={p.id}>{p.name}</option>
							{/each}
						</select>
					</label>
					<label class="text-xs font-medium text-gray-600">
						Tratamento financeiro
						<select
							name="financial_treatment_override"
							bind:value={bulkTreatment}
							class="mt-1 block w-full rounded-md border-gray-300 px-2 py-1 text-sm shadow-sm sm:w-40"
						>
							<option value={KEEP}>— manter —</option>
							<option value="">Automático (herdar)</option>
							{#each TREATMENT_OPTIONS as option (option.value)}
								<option value={option.value}>{option.label}</option>
							{/each}
						</select>
					</label>
					<button
						type="submit"
						disabled={!bulkHasChange || bulkApplying}
						class="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-indigo-300 sm:min-h-0"
					>
						{bulkApplying
							? 'Aplicando...'
							: `Aplicar a ${selectedForDelete.length}`}
					</button>
				</form>
			{/if}

			<button
				type="submit"
				form="transactions-delete-selected-form"
				disabled={selectedForDelete.length === 0}
				class="min-h-11 px-3 py-2 text-sm font-medium text-red-700 bg-red-50 rounded-md hover:bg-red-100 disabled:opacity-50 disabled:hover:bg-red-50 sm:min-h-0 sm:self-start lg:self-auto"
			>
				Excluir selecionadas
			</button>
		</div>

		<div class="hidden overflow-x-auto sm:block">
			<table
				class="min-w-full divide-y divide-gray-200 bg-white shadow rounded-lg"
			>
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left">
							<input
								type="checkbox"
								aria-label="Selecionar todas as transações visíveis"
								checked={visibleTransactions.length > 0 &&
									selectedForDelete.length === visibleTransactions.length}
								onchange={(event) => setAllVisible(event.currentTarget.checked)}
							/>
						</th>
						<th
							class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>Data</th
						>
						<th
							class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>Descrição</th
						>
						<th
							class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>Origem</th
						>
						<th
							class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>Classificação</th
						>
						<th
							class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>Atribuir a</th
						>
						<th
							class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
						>
							<button
								type="button"
								onclick={cycleAmountSort}
								class="inline-flex items-center gap-1 hover:text-gray-900 {amountSort !==
								'none'
									? 'text-indigo-700'
									: ''}"
								title={amountSort === 'none'
									? 'Ordenar por valor'
									: amountSort === 'desc'
										? 'Maior para menor'
										: 'Menor para maior'}
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
						<th
							class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
							>Status</th
						>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-200">
					{#each visibleTransactions as tx (tx.id)}
						<tr
							class={`${savingIds[tx.id] ? 'bg-indigo-50/40' : ''} ${displayedRetainedIds.has(tx.id) ? 'opacity-60' : ''}`}
						>
							<td class="px-4 py-3 align-top">
								<input
									type="checkbox"
									value={tx.id}
									bind:group={selectedForDelete}
									aria-label="Selecionar transação"
								/>
							</td>
							<td
								class="px-4 py-3 whitespace-nowrap text-sm text-gray-900 align-top"
								>{tx.date}</td
							>
							<td class="px-4 py-3 text-sm text-gray-900 align-top">
								<a
									href={resolve(`/app/transactions/${tx.id}`)}
									class="hover:text-indigo-600">{tx.description}</a
								>
								<form
									method="POST"
									action="?/toggle_transfer"
									use:enhance
									data-sveltekit-noscroll
									class="mt-1"
								>
									<input type="hidden" name="transaction_id" value={tx.id} />
									<input
										type="hidden"
										name="is_transfer"
										value={tx.is_transfer ? 'false' : 'true'}
									/>
									<button
										type="submit"
										class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium {tx.is_transfer
											? 'bg-sky-100 text-sky-800 hover:bg-sky-200'
											: 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}"
										title={tx.is_transfer
											? 'Deixar de tratar como transferência entre contas próprias'
											: 'Marcar como transferência entre contas próprias (fica fora dos totais)'}
									>
										<ArrowLeftRight class="h-3 w-3" />
										{tx.is_transfer ? 'Transferência' : 'Marcar transferência'}
									</button>
								</form>
							</td>
							<td
								class="px-4 py-3 whitespace-nowrap text-sm text-gray-700 align-top"
							>
								<span
									class="inline-flex rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700"
								>
									{sourceTypeText(tx.source_type)}
								</span>
								{#if tx.source_name}
									<span class="mt-1 block text-xs text-gray-500"
										>{tx.source_name}</span
									>
								{/if}
							</td>

							<td class="px-4 py-3 text-sm align-top">
								<!-- Hidden per-row form; the selects in this row associate via form= and
								     auto-save on change, spreadsheet style. -->
								<form
									id={`tx-form-${tx.id}`}
									method="POST"
									action="?/update_single_classification"
									use:enhance={({ formElement, submitter }) =>
										rowEnhance(tx, formElement, submitter)}
									data-sveltekit-noscroll
								>
									<input type="hidden" name="transaction_id" value={tx.id} />
									<input type="hidden" name="month" value={selectedMonth} />
									<input type="hidden" name="page" value={data.page} />
									<input
										type="hidden"
										name="profile_id_filter"
										value={filters.profileId}
									/>
									<input
										type="hidden"
										name="source_type_filter"
										value={filters.sourceType}
									/>
									<input
										type="hidden"
										name="account_filter"
										value={filters.account}
									/>
									<input
										type="hidden"
										name="category_id_filter"
										value={filters.categoryId}
									/>
									<input
										type="hidden"
										name="subcategory_id_filter"
										value={filters.subcategoryId}
									/>
									<input
										type="hidden"
										name="status_filter"
										value={filters.status}
									/>
									<input
										type="hidden"
										name="flow_filter"
										value={filters.flow}
									/>
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
										{#each parentCategories as cat (cat.id)}
											<option value={cat.id}>{cat.name}</option>
										{/each}
									</select>
									{#if creatingSubcategoryForId === tx.id}
										<div class="flex w-40 gap-1">
											<input
												type="hidden"
												name="subcategory_id"
												value={tx.subcategory_id ?? ''}
												form={`tx-form-${tx.id}`}
											/>
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
												disabled={!newSubcategoryName.trim() ||
													savingIds[tx.id]}
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
											{#each rowSubcategories(tx.category_id) as sub (sub.id)}
												<option value={sub.id}>{sub.name}</option>
											{/each}
											{#if tx.category_id}
												<option value={NEW_SUBCATEGORY}>+ Criar nova…</option>
											{/if}
										</select>
									{/if}
									<select
										name="financial_treatment_override"
										form={`tx-form-${tx.id}`}
										value={tx.financial_treatment_override ?? ''}
										disabled={savingIds[tx.id]}
										onchange={submitRowForm}
										aria-label="Tratamento financeiro"
										class="block w-40 rounded-md border-gray-300 px-2 py-1 text-xs shadow-sm disabled:bg-gray-100"
									>
										<option value="">Automático</option>
										{#each TREATMENT_OPTIONS as option (option.value)}
											<option value={option.value}>{option.label}</option>
										{/each}
									</select>
									{#if suggestionLabel(tx)}
										<span class="w-40 text-xs text-amber-700"
											>sugerido: {suggestionLabel(tx)}</span
										>
									{/if}
									{#if rowErrors[tx.id]}
										<span class="w-40 text-xs text-red-600" role="alert"
											>{rowErrors[tx.id]}</span
										>
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
									{#each profiles as p (p.id)}
										<option value={p.id}>{p.name}</option>
									{/each}
								</select>
							</td>

							<td
								class="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right align-top"
							>
								{money(tx.amount, tx.currency ?? 'BRL')}
							</td>
							<td class="px-4 py-3 whitespace-nowrap text-sm align-top">
								{@render flowBadge(tx)}
								<TransactionStatusActions
									{tx}
									busy={statusChangingId === tx.id}
									enhanceFor={keepScrollOnStatusChange}
									size="compact"
								/>
								{@render txNotes(tx)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="space-y-3 sm:hidden">
			<div class="flex items-center justify-between gap-3">
				<label class="flex min-h-11 items-center gap-2 text-sm text-gray-700">
					<input
						type="checkbox"
						aria-label="Selecionar todas as transações visíveis"
						checked={visibleTransactions.length > 0 &&
							selectedForDelete.length === visibleTransactions.length}
						onchange={(event) => setAllVisible(event.currentTarget.checked)}
					/>
					Selecionar todas
				</label>
				<label class="flex items-center gap-2 text-sm text-gray-700">
					Ordenar
					<select
						bind:value={amountSort}
						class="rounded-md border-gray-300 px-2 py-2 text-sm shadow-sm"
					>
						<option value="none">Data</option>
						<option value="desc">Maior valor</option>
						<option value="asc">Menor valor</option>
					</select>
				</label>
			</div>
			<ul class="space-y-3">
				{#each visibleTransactions as tx (tx.id)}
					<li
						class="space-y-2 rounded-lg bg-white p-3 shadow {savingIds[tx.id]
							? 'bg-indigo-50/40'
							: ''} {displayedRetainedIds.has(tx.id) ? 'opacity-60' : ''}"
					>
						<div class="flex items-center gap-1 text-xs text-gray-500">
							<label
								class="-m-1 flex min-h-11 min-w-11 items-center justify-center"
							>
								<input
									type="checkbox"
									value={tx.id}
									bind:group={selectedForDelete}
									aria-label="Selecionar transação"
								/>
							</label>
							<span>{tx.date}</span>
							{#if tx.source_name}
								<span class="truncate">· {tx.source_name}</span>
							{/if}
						</div>
						<div class="flex items-start justify-between gap-3">
							<a
								href={resolve(`/app/transactions/${tx.id}`)}
								class="line-clamp-2 min-w-0 text-sm font-medium text-gray-900"
								>{tx.description}</a
							>
							<span
								class="shrink-0 text-sm font-semibold {tx.amount < 0
									? 'text-red-700'
									: 'text-green-700'}">{brl(tx.amount)}</span
							>
						</div>
						<p
							class="text-sm {suggestionLabel(tx)
								? 'text-amber-700'
								: 'text-gray-700'}"
						>
							{#if suggestionLabel(tx)}
								sugerido: {suggestionLabel(tx)}
							{:else if tx.category_display_name}
								{tx.category_display_name}{tx.subcategory_display_name
									? ` · ${tx.subcategory_display_name}`
									: ''}
							{:else}
								Sem categoria
							{/if}
						</p>
						{@render flowBadge(tx)}
						{@render txNotes(tx)}
						<TransactionStatusActions
							{tx}
							busy={statusChangingId === tx.id}
							enhanceFor={keepScrollOnStatusChange}
							size="touch"
						/>
					</li>
				{/each}
			</ul>
			{#if selectedForDelete.length > 0}
				<div class="h-64" aria-hidden="true"></div>
			{/if}
		</div>

		<div class="flex items-center justify-between text-sm text-gray-600">
			<p>Página {data.page + 1}</p>
			<div class="flex gap-2">
				{#if data.page > 0}
					<a
						class="px-3 py-2 border rounded-md bg-white hover:bg-gray-50"
						href={resolve(
							transactionsHref({
								page: data.page - 1
							}) as `/app/transactions?${string}`
						)}>Anterior</a
					>
				{/if}
				{#if data.hasMore}
					<a
						class="px-3 py-2 border rounded-md bg-white hover:bg-gray-50"
						href={resolve(
							transactionsHref({
								page: data.page + 1
							}) as `/app/transactions?${string}`
						)}>Próxima</a
					>
				{/if}
			</div>
		</div>
	{/if}
</div>

{#snippet filterFields(prefix: string)}
	<div>
		<label
			for="{prefix}source-type-filter"
			class="block text-xs font-medium uppercase tracking-wider text-gray-500"
			>Origem</label
		>
		<select
			id="{prefix}source-type-filter"
			class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
			value={filters.sourceType}
			onchange={(event) => {
				window.location.href = transactionsHref({
					sourceType: event.currentTarget.value,
					page: 0
				});
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
		<label
			for="{prefix}account-filter"
			class="block text-xs font-medium uppercase tracking-wider text-gray-500"
			>Conta</label
		>
		<select
			id="{prefix}account-filter"
			class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
			value={filters.account}
			onchange={(event) => {
				window.location.href = transactionsHref({
					account: event.currentTarget.value,
					page: 0
				});
			}}
		>
			<option value="all">Todas</option>
			{#each accounts as account (account.name)}
				<option value={account.name}>{account.name}</option>
			{/each}
			<option value="__none__">Sem conta informada</option>
		</select>
	</div>

	<div>
		<label
			for="{prefix}category-filter"
			class="block text-xs font-medium uppercase tracking-wider text-gray-500"
			>Categoria</label
		>
		<select
			id="{prefix}category-filter"
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
			{#each parentCategories as cat (cat.id)}
				<option value={cat.id}>{cat.name}</option>
			{/each}
		</select>
	</div>

	<div>
		<label
			for="{prefix}subcategory-filter"
			class="block text-xs font-medium uppercase tracking-wider text-gray-500"
			>Subcategoria</label
		>
		<select
			id="{prefix}subcategory-filter"
			class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm disabled:bg-gray-100"
			value={filters.subcategoryId}
			disabled={!filters.categoryId}
			onchange={(event) => {
				window.location.href = transactionsHref({
					subcategoryId: event.currentTarget.value,
					page: 0
				});
			}}
		>
			<option value="">Todas</option>
			{#each filterSubcategories as sub (sub.id)}
				<option value={sub.id}>{sub.name}</option>
			{/each}
		</select>
	</div>

	<div>
		<label
			for="{prefix}status-filter"
			class="block text-xs font-medium uppercase tracking-wider text-gray-500"
			>Status</label
		>
		<select
			id="{prefix}status-filter"
			class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
			value={filters.status}
			onchange={(event) => {
				window.location.href = transactionsHref({
					status: event.currentTarget.value,
					page: 0
				});
			}}
		>
			<option value="all">Todos</option>
			<option value="needs_review">Revisar</option>
			<option value="confirmed">Confirmado</option>
			<option value="ignored">Ignorado</option>
		</select>
	</div>

	<div>
		<label
			for="{prefix}direction-filter"
			class="block text-xs font-medium uppercase tracking-wider text-gray-500"
			>Entrada/Saída</label
		>
		<select
			id="{prefix}direction-filter"
			class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
			value={filters.direction}
			onchange={(event) => {
				window.location.href = transactionsHref({
					direction: event.currentTarget.value,
					page: 0
				});
			}}
		>
			<option value="all">Todas</option>
			<option value="in">Só receitas</option>
			<option value="out">Só despesas</option>
		</select>
	</div>

	<div>
		<label
			for="{prefix}flow-filter"
			class="block text-xs font-medium uppercase tracking-wider text-gray-500"
			>Fluxo classificado</label
		>
		<select
			id="{prefix}flow-filter"
			class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
			value={filters.flow}
			onchange={(event) => {
				window.location.href = transactionsHref({
					flow: event.currentTarget.value,
					page: 0
				});
			}}
		>
			<option value="all">Todos</option>
			<option value="spending">Despesas e reembolsos</option>
			<option value="expense">Despesas</option>
			<option value="refund">Reembolsos</option>
			<option value="income">Receitas</option>
			<option value="contribution">Aportes</option>
			<option value="redemption">Resgates</option>
			<option value="investment_income">Proventos</option>
			<option value="transfer">Transferências</option>
		</select>
	</div>

	<div class="flex items-end">
		<a
			href={resolve(
				transactionsHref({
					sourceType: 'all',
					account: 'all',
					categoryId: '',
					subcategoryId: '',
					status: 'all',
					direction: 'all',
					flow: 'all',
					page: 0
				}) as `/app/transactions?${string}`
			)}
			class={`inline-flex w-full justify-center rounded-md border px-3 py-2 text-sm font-medium ${
				hasActiveFilters()
					? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
					: 'pointer-events-none border-gray-200 bg-gray-50 text-gray-400'
			}`}
		>
			Limpar filtros
		</a>
	</div>
{/snippet}

{#snippet flowBadge(tx: Transaction)}
	{#if tx.financial_flow_kind && tx.financial_flow_kind !== 'excluded'}
		<span
			class="mb-1 inline-flex rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"
		>
			{flowKindLabel(tx.financial_flow_kind)}
		</span>
	{/if}
{/snippet}

{#snippet txNotes(tx: Transaction)}
	{#if reviewNote(tx)}
		<span class="mt-1 block max-w-56 text-xs text-amber-700"
			>{reviewNote(tx)}</span
		>
	{/if}
	{#if displayedRetainedIds.has(tx.id)}
		<span class="mt-1 block text-xs text-gray-400">Fora do filtro atual</span>
	{/if}
{/snippet}

<Sheet open={filtersOpen} title="Filtros" onClose={() => (filtersOpen = false)}>
	<div class="grid gap-3">
		{@render filterFields('sheet-')}
	</div>
</Sheet>
