<script lang="ts">
	import { enhance } from '$app/forms';
	import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, CircleDollarSign, PiggyBank, ReceiptText, RefreshCcw, SlidersHorizontal, Sparkles, X } from 'lucide-svelte';
	import CategoryTreemap from '$lib/components/charts/CategoryTreemap.svelte';
	import type { TreemapSelection } from '$lib/components/charts/CategoryTreemap.svelte';
	import MonthlyTrendChart from '$lib/components/charts/MonthlyTrendChart.svelte';
	import CategoryTrendChart from '$lib/components/charts/CategoryTrendChart.svelte';

	let { data, form } = $props();
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
	let filteredTransactions = $derived(data.filteredTransactions ?? []);
	let hasActiveSecondaryFilter = $derived(!!(filters.profileId || filters.categoryId || filters.reviewStatus));
	let showFilters = $state(false);
	let selection = $state<TreemapSelection | null>(null);

	let categoryTrend = $derived(data.categoryTrend ?? { months: [], series: [], points: [] });
	let aboveNormal = $derived(data.aboveNormal ?? []);
	let savingsHistory = $derived(data.savingsHistory ?? []);
	let fixedVsVariable = $derived(data.fixedVsVariable ?? { fixedTotal: 0, variableTotal: 0, topFixed: [] });
	let installmentForecast = $derived(data.installmentForecast ?? { months: [], totalCommitted: 0 });
	let projection = $derived(data.projection ?? null);

	let currentSavings = $derived(savingsHistory.find((h) => h.month === selectedMonth) ?? null);
	let fixedShare = $derived.by(() => {
		const total = fixedVsVariable.fixedTotal + fixedVsVariable.variableTotal;
		return total > 0 ? Math.round((fixedVsVariable.fixedTotal / total) * 100) : 0;
	});
	let maxForecastTotal = $derived(Math.max(1, ...installmentForecast.months.map((m) => m.total)));

	let generatingInsights = $state(false);
	let insights = $derived(form?.insights && form?.insightsMonth === selectedMonth ? form.insights : null);

	function insightsEnhance() {
		generatingInsights = true;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			generatingInsights = false;
		};
	}

	const UNCATEGORIZED_ID = '__uncategorized__';
	const UNSPECIFIED_SUB_ID = '__unspecified__';

	let drillDownTx = $derived.by(() => {
		const sel = selection;
		if (!sel) return [] as typeof filteredTransactions;
		return filteredTransactions
			.filter((tx) => {
				const txCat = tx.category_id ?? UNCATEGORIZED_ID;
				const txSub = tx.subcategory_id ?? UNSPECIFIED_SUB_ID;
				if (txCat !== sel.categoryId) return false;
				// Self-leaf (no real subcategory under that category)
				if (sel.subcategoryId.endsWith('-self')) {
					return tx.subcategory_id === null;
				}
				return txSub === sel.subcategoryId;
			})
			.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
	});

	let drillDownTotal = $derived(drillDownTx.reduce((sum, tx) => sum + Math.abs(tx.amount), 0));

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

	function formatPercent(value: number) {
		return `${Math.round(value * 100)}%`;
	}

	function shortMonthLabel(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return month;
		return new Date(year, monthNumber - 1, 1)
			.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
			.replace('.', '');
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

		<section class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
			<div class="rounded-lg bg-white p-4 shadow">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-gray-500">Taxa de poupança</p>
					<PiggyBank class="h-5 w-5 text-emerald-600" />
				</div>
				<p class={`mt-3 text-2xl font-semibold ${currentSavings?.rate != null && currentSavings.rate < 0 ? 'text-rose-700' : 'text-gray-950'}`}>
					{currentSavings?.rate != null ? formatPercent(currentSavings.rate) : '—'}
				</p>
				<p class="mt-1 text-xs text-gray-500">do que entrou, sobrou no mês</p>
				{#if savingsHistory.length > 1}
					<div class="mt-3 flex h-10 items-end gap-1" aria-hidden="true">
						{#each savingsHistory as h (h.month)}
							<div
								class={`min-w-0 flex-1 rounded-sm ${h.rate == null ? 'bg-gray-200' : h.rate >= 0 ? 'bg-emerald-500' : 'bg-rose-500'} ${h.month === selectedMonth ? '' : 'opacity-50'}`}
								style={`height: ${h.rate == null ? 8 : Math.max(8, Math.min(100, Math.abs(h.rate) * 100)) * 0.4}px`}
								title={`${shortMonthLabel(h.month)}: ${h.rate == null ? 'sem receitas' : formatPercent(h.rate)}`}
							></div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="rounded-lg bg-white p-4 shadow">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-gray-500">Fixos vs variáveis</p>
					<RefreshCcw class="h-5 w-5 text-indigo-600" />
				</div>
				<p class="mt-3 text-2xl font-semibold text-gray-950">{fixedShare}% <span class="text-sm font-medium text-gray-500">fixos</span></p>
				<div class="mt-2 flex h-2 overflow-hidden rounded bg-gray-100">
					<div class="h-2 bg-[#2a78d6]" style={`width: ${fixedShare}%`}></div>
				</div>
				<p class="mt-1 text-xs text-gray-500">
					{formatCurrency(fixedVsVariable.fixedTotal)} recorrentes/parcelas · {formatCurrency(fixedVsVariable.variableTotal)} variáveis
				</p>
				{#if fixedVsVariable.topFixed.length > 0}
					<ul class="mt-2 space-y-0.5 text-[11px] text-gray-500">
						{#each fixedVsVariable.topFixed.slice(0, 3) as item}
							<li class="flex justify-between gap-2"><span class="truncate">{item.name}</span><span class="shrink-0">{formatCurrency(item.total)}</span></li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if projection}
				<div class="rounded-lg bg-white p-4 shadow">
					<div class="flex items-center justify-between">
						<p class="text-sm font-medium text-gray-500">Projeção do mês</p>
						<CalendarClock class="h-5 w-5 text-amber-600" />
					</div>
					<p class="mt-3 text-2xl font-semibold text-gray-950">{formatCurrency(projection.projected)}</p>
					<p class="mt-1 text-xs text-gray-500">nesse ritmo até o fim do mês</p>
					{#if projection.percentVsBaseline != null && projection.baseline != null}
						<p class={`mt-2 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${projection.percentVsBaseline > 5 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
							{#if projection.percentVsBaseline > 0}
								<ArrowUpRight class="h-3.5 w-3.5" />
							{:else}
								<ArrowDownRight class="h-3.5 w-3.5" />
							{/if}
							{Math.abs(projection.percentVsBaseline)}% vs média de {formatCurrency(projection.baseline)}
						</p>
					{/if}
				</div>
			{/if}

			<div class="rounded-lg bg-white p-4 shadow">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium text-gray-500">Parcelas futuras</p>
					<ReceiptText class="h-5 w-5 text-violet-600" />
				</div>
				<p class="mt-3 text-2xl font-semibold text-gray-950">{formatCurrency(installmentForecast.totalCommitted)}</p>
				<p class="mt-1 text-xs text-gray-500">já comprometidos em parcelas</p>
				{#if installmentForecast.months.length > 0}
					<p class="mt-2 text-xs text-gray-500">
						Próximo mês: <span class="font-medium text-gray-800">{formatCurrency(installmentForecast.months[0].total)}</span>
						({installmentForecast.months[0].count} {installmentForecast.months[0].count === 1 ? 'parcela' : 'parcelas'})
					</p>
				{/if}
			</div>
		</section>

		<section class="rounded-lg bg-white p-5 shadow">
			<div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h3 class="text-sm font-semibold text-gray-900">Para onde foi o dinheiro</h3>
					<p class="text-xs text-gray-500">{selection ? 'Clique fora ou em outro item para mudar o foco' : 'Clique em um item para ver as transações.'}</p>
				</div>
				<p class="text-lg font-semibold text-gray-900">{formatCurrency(totalExpenses)}</p>
			</div>
			<div class={`mt-4 grid gap-4 ${selection ? 'lg:grid-cols-[1fr_360px]' : 'grid-cols-1'}`}>
				<div>
					<CategoryTreemap nodes={expenseHierarchy} height={460} selected={selection} onSelect={(s) => (selection = s)} />
				</div>
				{#if selection}
					<aside class="flex h-[460px] flex-col rounded-md border border-gray-200 bg-gray-50">
						<div class="flex items-start justify-between border-b border-gray-200 bg-white px-4 py-3">
							<div class="min-w-0">
								<p class="text-[11px] uppercase tracking-wide text-gray-500">{selection.categoryName}</p>
								<p class="truncate text-sm font-semibold text-gray-900">{selection.subcategoryName === selection.categoryName ? 'Sem subcategoria' : selection.subcategoryName}</p>
								<p class="mt-0.5 text-xs text-gray-500">{drillDownTx.length} {drillDownTx.length === 1 ? 'transação' : 'transações'} · {formatCurrency(drillDownTotal)}</p>
							</div>
							<button
								type="button"
								onclick={() => (selection = null)}
								class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
								aria-label="Fechar"
							>
								<X class="h-4 w-4" />
							</button>
						</div>
						<div class="flex-1 overflow-y-auto">
							{#if drillDownTx.length === 0}
								<p class="p-4 text-xs text-gray-500">Nenhuma transação para este item.</p>
							{:else}
								<ul class="divide-y divide-gray-100">
									{#each drillDownTx as tx}
										<li>
											<a href={`/app/transactions/${tx.id}`} class="flex items-start justify-between gap-3 px-4 py-2.5 text-sm hover:bg-white">
												<div class="min-w-0">
													<p class="truncate font-medium text-gray-900">{tx.description}</p>
													<p class="text-[11px] text-gray-500">{tx.date}</p>
												</div>
												<span class={`shrink-0 text-sm font-medium ${tx.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
													{formatCurrency(tx.amount, tx.currency ?? 'BRL')}
												</span>
											</a>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					</aside>
				{/if}
			</div>
		</section>

		<section class="grid grid-cols-1 gap-4 xl:grid-cols-3">
			<div class="rounded-lg bg-white p-5 shadow xl:col-span-2">
				<h3 class="text-sm font-semibold text-gray-900">Evolução por categoria</h3>
				<p class="text-xs text-gray-500">Despesas mensais das principais categorias (últimos {categoryTrend.months.length} meses)</p>
				<div class="mt-4">
					<CategoryTrendChart series={categoryTrend.series} points={categoryTrend.points} />
				</div>
			</div>

			<div class="rounded-lg bg-white p-5 shadow">
				<h3 class="text-sm font-semibold text-gray-900">Fora do normal em {formatMonth(selectedMonth)}</h3>
				<p class="text-xs text-gray-500">Comparado à média dos meses anteriores</p>
				<div class="mt-3 space-y-3">
					{#each aboveNormal as item (item.id)}
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium text-gray-900">{item.name}</p>
								<p class="text-[11px] text-gray-500">{formatCurrency(item.current)} vs média {formatCurrency(item.baseline)}</p>
							</div>
							<span class={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${item.delta > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
								{item.delta > 0 ? '+' : '−'}{formatCurrency(Math.abs(item.delta))}{item.deltaPercent != null ? ` (${item.delta > 0 ? '+' : '−'}${Math.abs(item.deltaPercent)}%)` : ''}
							</span>
						</div>
					{/each}
					{#if aboveNormal.length === 0}
						<p class="text-xs text-gray-500">Nada fora do padrão — ou ainda não há meses anteriores suficientes para comparar.</p>
					{/if}
				</div>
			</div>
		</section>

		<section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
			<div class="rounded-lg bg-white p-5 shadow">
				<h3 class="text-sm font-semibold text-gray-900">Parcelas nos próximos meses</h3>
				<p class="text-xs text-gray-500">Compromissos já assumidos em compras parceladas</p>
				<div class="mt-4 space-y-3">
					{#each installmentForecast.months as m (m.month)}
						<div>
							<div class="flex items-center justify-between gap-3 text-sm">
								<span class="capitalize text-gray-700">{formatMonth(m.month)}</span>
								<span class="font-medium text-gray-950">{formatCurrency(m.total)} <span class="text-xs font-normal text-gray-500">· {m.count} {m.count === 1 ? 'parcela' : 'parcelas'}</span></span>
							</div>
							<div class="mt-1 h-2 rounded bg-gray-100">
								<div class="h-2 rounded bg-violet-500" style={`width: ${Math.round((m.total / maxForecastTotal) * 100)}%`}></div>
							</div>
						</div>
					{/each}
					{#if installmentForecast.months.length === 0}
						<p class="text-xs text-gray-500">Nenhuma parcela futura identificada.</p>
					{/if}
				</div>
			</div>

			<div class="rounded-lg bg-white p-5 shadow">
				<div class="flex items-start justify-between gap-3">
					<div>
						<h3 class="text-sm font-semibold text-gray-900">Insights do mês</h3>
						<p class="text-xs text-gray-500">Resumo gerado por IA a partir dos números de {formatMonth(selectedMonth)}</p>
					</div>
					<form method="POST" action="?/insights" use:enhance={insightsEnhance}>
						<input type="hidden" name="month" value={selectedMonth} />
						<button
							type="submit"
							disabled={generatingInsights || !selectedMonth}
							class="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300"
						>
							{#if generatingInsights}
								<span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true"></span>
								Gerando...
							{:else}
								<Sparkles class="h-3.5 w-3.5" />
								{insights ? 'Gerar novamente' : 'Gerar insights'}
							{/if}
						</button>
					</form>
				</div>
				<div class="mt-4">
					{#if insights}
						<ul class="space-y-2.5">
							{#each insights as insight}
								<li class="flex items-start gap-2 text-sm text-gray-800">
									<span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden="true"></span>
									{insight}
								</li>
							{/each}
						</ul>
					{:else if form?.message && !form?.insights}
						<p class="text-sm text-rose-700">{form.message}</p>
					{:else if !generatingInsights}
						<p class="text-xs text-gray-500">Clique em "Gerar insights" para um resumo do que mudou neste mês: categorias fora do padrão, gastos novos e peso dos compromissos fixos.</p>
					{/if}
				</div>
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
