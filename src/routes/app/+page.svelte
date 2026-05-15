<script lang="ts">
	import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleDollarSign, ReceiptText, SlidersHorizontal } from 'lucide-svelte';
	import CategoryTreemap from '$lib/components/charts/CategoryTreemap.svelte';
	import MonthlyTrendChart from '$lib/components/charts/MonthlyTrendChart.svelte';

	let { data } = $props();
	let summary = $derived(data.summary);
	let previousSummary = $derived(data.previousSummary);
	let monthOptions = $derived(data.monthOptions ?? []);
	let selectedMonth = $derived(data.selectedMonth ?? '');
	let monthlyTrend = $derived(data.monthlyTrend ?? []);
	let expenseHierarchy = $derived(data.expenseHierarchy ?? []);
	let totalExpenses = $derived(data.totalExpenses ?? 0);
	let byProfile = $derived(data.byProfile ?? []);
	let byPayer = $derived(data.byPayer ?? []);
	let recentTransactions = $derived(data.recentTransactions ?? []);
	let profiles = $derived(data.profiles ?? []);
	let categories = $derived(data.categories ?? []);
	let filters = $derived(data.filters ?? { profileId: '', categoryId: '', reviewStatus: '' });
	let hasActiveSecondaryFilter = $derived(!!(filters.profileId || filters.categoryId || filters.reviewStatus));
	let showFilters = $state(false);

	let expenseDelta = $derived(summary.expenses - previousSummary.expenses);
	let expenseDeltaPercent = $derived(
		previousSummary.expenses > 0 ? Math.round((expenseDelta / previousSummary.expenses) * 100) : null
	);

	function formatCurrency(value: number, currency = 'BRL') {
		return value.toLocaleString('pt-BR', { style: 'currency', currency });
	}

	function formatMonth(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return month || 'Sem mês';
		return new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
	}

	function buildHref(params: Partial<{ month: string; profile: string; category: string; review_status: string }>) {
		const merged = {
			month: selectedMonth,
			profile: filters.profileId,
			category: filters.categoryId,
			review_status: filters.reviewStatus,
			...params
		};
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(merged)) {
			if (v) qs.set(k, String(v));
		}
		const s = qs.toString();
		return s ? `/app?${s}` : '/app';
	}

	function navigate(params: Partial<{ month: string; profile: string; category: string; review_status: string }>) {
		window.location.href = buildHref(params);
	}

	function reviewStatusLabel(status: string) {
		if (status === 'needs_review') return 'Revisar';
		if (status === 'confirmed') return 'Confirmado';
		return status || 'Sem status';
	}
</script>

<svelte:head>
	<title>Visão geral | Planner</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
		<div>
			<p class="text-sm font-medium uppercase tracking-wider text-gray-500">Visão geral</p>
			<h2 class="mt-1 text-2xl font-semibold text-gray-950">{selectedMonth ? formatMonth(selectedMonth) : 'Sem dados'}</h2>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<label for="month-filter" class="sr-only">Mês</label>
			<select
				id="month-filter"
				class="rounded-md border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
				value={selectedMonth}
				onchange={(event) => navigate({ month: event.currentTarget.value })}
			>
				{#if monthOptions.length === 0}
					<option value="">Sem dados</option>
				{/if}
				{#each monthOptions as month}
					<option value={month}>{formatMonth(month)}</option>
				{/each}
			</select>

			<button
				type="button"
				onclick={() => (showFilters = !showFilters)}
				class={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm shadow-sm transition ${hasActiveSecondaryFilter ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
				aria-expanded={showFilters}
			>
				<SlidersHorizontal class="h-4 w-4" />
				Filtros
				{#if hasActiveSecondaryFilter}
					<span class="ml-1 rounded-full bg-indigo-200 px-1.5 text-[10px] font-semibold text-indigo-800">
						{[filters.profileId, filters.categoryId, filters.reviewStatus].filter(Boolean).length}
					</span>
				{/if}
			</button>
		</div>
	</div>

	{#if showFilters}
		<form method="GET" class="grid grid-cols-1 gap-3 rounded-lg bg-white p-4 shadow sm:grid-cols-4">
			<input type="hidden" name="month" value={selectedMonth} />
			<div>
				<label for="profile" class="block text-xs font-medium text-gray-600">Perfil</label>
				<select id="profile" name="profile" class="mt-1 w-full rounded-md border-gray-300 text-sm px-2 py-1.5">
					<option value="">Todos</option>
					{#each profiles as p}
						<option value={p.id} selected={p.id === filters.profileId}>{p.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="category" class="block text-xs font-medium text-gray-600">Categoria</label>
				<select id="category" name="category" class="mt-1 w-full rounded-md border-gray-300 text-sm px-2 py-1.5">
					<option value="">Todas</option>
					{#each categories as c}
						<option value={c.id} selected={c.id === filters.categoryId}>{c.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label for="review_status" class="block text-xs font-medium text-gray-600">Status</label>
				<select id="review_status" name="review_status" class="mt-1 w-full rounded-md border-gray-300 text-sm px-2 py-1.5">
					<option value="">Todos</option>
					<option value="needs_review" selected={filters.reviewStatus === 'needs_review'}>Revisar</option>
					<option value="confirmed" selected={filters.reviewStatus === 'confirmed'}>Confirmado</option>
					<option value="ignored" selected={filters.reviewStatus === 'ignored'}>Ignorado</option>
				</select>
			</div>
			<div class="flex items-end gap-2">
				<button type="submit" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">Aplicar</button>
				{#if hasActiveSecondaryFilter}
					<a href={buildHref({ profile: '', category: '', review_status: '' })} class="text-xs text-gray-500 underline hover:text-gray-700">Limpar</a>
				{/if}
			</div>
		</form>
	{/if}

	{#if summary.count === 0}
		<section class="bg-white p-6 shadow rounded-lg">
			<div class="max-w-2xl">
				<h3 class="text-lg font-semibold text-gray-900">Ainda não há dados para mostrar</h3>
				<p class="mt-2 text-sm text-gray-600">
					Importe uma fatura ou cadastre transações para liberar indicadores de gastos, revisão e categorias.
				</p>
				<div class="mt-4 flex flex-wrap gap-3">
					<a href="/app/imports" class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Importar fatura</a>
					<a href="/app/transactions/new" class="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Nova transação</a>
				</div>
			</div>
		</section>
	{:else}
		<section class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
			<div class="rounded-lg bg-white p-4 shadow">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-gray-500">Despesas</p>
					<CircleDollarSign class="h-5 w-5 text-rose-600" />
				</div>
				<p class="mt-3 text-2xl font-semibold text-gray-950">{formatCurrency(summary.expenses)}</p>
				<p class={`mt-1 flex items-center gap-1 text-xs ${expenseDelta <= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
					{#if expenseDelta <= 0}
						<ArrowDownRight class="h-3.5 w-3.5" />
					{:else}
						<ArrowUpRight class="h-3.5 w-3.5" />
					{/if}
					{expenseDeltaPercent === null ? 'Sem mês anterior' : `${Math.abs(expenseDeltaPercent)}% vs mês anterior`}
				</p>
			</div>

			<div class="rounded-lg bg-white p-4 shadow">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-gray-500">Receitas</p>
					<ArrowUpRight class="h-5 w-5 text-emerald-600" />
				</div>
				<p class="mt-3 text-2xl font-semibold text-gray-950">{formatCurrency(summary.credits)}</p>
				<p class="mt-1 text-xs text-gray-500">Saldo: <span class={summary.balance >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatCurrency(summary.balance)}</span></p>
			</div>

			<a href="/app/review" class="rounded-lg bg-white p-4 shadow transition hover:-translate-y-0.5 hover:shadow-md">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-gray-500">Pendentes</p>
					<AlertTriangle class="h-5 w-5 text-amber-600" />
				</div>
				<p class="mt-3 text-2xl font-semibold text-gray-950">{summary.needsReview}</p>
				<p class="mt-1 text-xs text-gray-500">Aguardando confirmação</p>
			</a>

			<a href={`/app/transactions?month=${encodeURIComponent(selectedMonth)}`} class="rounded-lg bg-white p-4 shadow transition hover:-translate-y-0.5 hover:shadow-md">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-gray-500">Transações</p>
					<ReceiptText class="h-5 w-5 text-sky-600" />
				</div>
				<p class="mt-3 text-2xl font-semibold text-gray-950">{summary.count}</p>
				<p class="mt-1 text-xs text-gray-500">{summary.uncategorized} sem categoria</p>
			</a>
		</section>

		<section class="rounded-lg bg-white p-5 shadow">
			<div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h3 class="text-sm font-semibold text-gray-900">Para onde foi o dinheiro</h3>
					<p class="text-xs text-gray-500">Despesas por categoria e subcategoria.</p>
				</div>
				<p class="text-lg font-semibold text-gray-900">{formatCurrency(totalExpenses)}</p>
			</div>
			<div class="mt-4">
				<CategoryTreemap nodes={expenseHierarchy} height={460} />
			</div>
		</section>

		<section class="grid grid-cols-1 gap-4 xl:grid-cols-3">
			<div class="rounded-lg bg-white p-4 shadow xl:col-span-2">
				<h3 class="text-sm font-semibold text-gray-900">Receitas vs despesas</h3>
				<p class="text-xs text-gray-500">Últimos 6 meses</p>
				<div class="mt-4">
					<MonthlyTrendChart data={monthlyTrend} />
				</div>
			</div>

			<div class="rounded-lg bg-white p-4 shadow">
				<h3 class="text-sm font-semibold text-gray-900">Transações recentes</h3>
				<div class="mt-3 overflow-hidden rounded-md border border-gray-100">
					<table class="min-w-full divide-y divide-gray-100 text-sm">
						<tbody class="divide-y divide-gray-100">
							{#each recentTransactions as transaction}
								<tr>
									<td class="px-3 py-2.5">
										<a href={`/app/transactions/${transaction.id}`} class="font-medium text-gray-900 hover:text-indigo-700">{transaction.description}</a>
										<p class="mt-0.5 text-[11px] text-gray-500">{transaction.date} · {reviewStatusLabel(transaction.review_status)}</p>
									</td>
									<td class={`px-3 py-2.5 text-right text-sm font-medium ${transaction.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
										{formatCurrency(transaction.amount, transaction.currency ?? 'BRL')}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<a href={`/app/transactions?month=${encodeURIComponent(selectedMonth)}`} class="mt-3 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-800">Ver todas →</a>
			</div>
		</section>

		<section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
			<div class="rounded-lg bg-white p-4 shadow">
				<h3 class="text-sm font-semibold text-gray-900">Por perfil</h3>
				<div class="mt-3 space-y-3">
					{#each byProfile as row}
						<div>
							<div class="flex items-center justify-between gap-3 text-sm">
								<span class="truncate text-gray-700">{row.name}</span>
								<span class="font-medium text-gray-950">{formatCurrency(row.total)}</span>
							</div>
							<div class="mt-1 flex items-center gap-2">
								<div class="h-2 flex-1 rounded bg-gray-100">
									<div class="h-2 rounded bg-sky-500" style={`width: ${row.share}%`}></div>
								</div>
								<span class="w-9 text-right text-xs text-gray-500">{row.share}%</span>
							</div>
						</div>
					{/each}
					{#if byProfile.length === 0}
						<p class="text-xs text-gray-500">Sem dados.</p>
					{/if}
				</div>
			</div>

			<div class="rounded-lg bg-white p-4 shadow">
				<h3 class="text-sm font-semibold text-gray-900">Por pagador</h3>
				<div class="mt-3 space-y-3">
					{#each byPayer as row}
						<div>
							<div class="flex items-center justify-between gap-3 text-sm">
								<span class="truncate text-gray-700">{row.name}</span>
								<span class="font-medium text-gray-950">{formatCurrency(row.total)}</span>
							</div>
							<div class="mt-1 flex items-center gap-2">
								<div class="h-2 flex-1 rounded bg-gray-100">
									<div class="h-2 rounded bg-indigo-500" style={`width: ${row.share}%`}></div>
								</div>
								<span class="w-9 text-right text-xs text-gray-500">{row.share}%</span>
							</div>
						</div>
					{/each}
					{#if byPayer.length === 0}
						<p class="text-xs text-gray-500">Sem dados.</p>
					{/if}
				</div>
			</div>
		</section>
	{/if}
</div>
