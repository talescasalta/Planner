<script lang="ts">
	import { dateShort, formatMonthLong, money } from '$lib/format';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		AlertTriangle,
		ArrowDownRight,
		ArrowUpRight,
		CalendarClock,
		CircleDollarSign,
		Info,
		PiggyBank,
		SlidersHorizontal,
		Sparkles,
		X
	} from 'lucide-svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import CategoryBars from '$lib/components/charts/CategoryBars.svelte';
	import CategoryTreemap from '$lib/components/charts/CategoryTreemap.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import StatTile from '$lib/components/ui/StatTile.svelte';
	import type { TreemapSelection } from '$lib/components/charts/CategoryTreemap.svelte';
	import MonthlyTrendChart from '$lib/components/charts/MonthlyTrendChart.svelte';
	import CategoryTrendChart from '$lib/components/charts/CategoryTrendChart.svelte';
	import OnboardingChecklist from '$lib/components/OnboardingChecklist.svelte';
	import { buildOnboardingSteps } from '$lib/onboarding';

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
	let filters = $derived(
		data.filters ?? { profileId: '', categoryId: '', reviewStatus: '' }
	);
	let filteredTransactions = $derived(data.filteredTransactions ?? []);
	let hasActiveSecondaryFilter = $derived(
		!!(filters.profileId || filters.categoryId || filters.reviewStatus)
	);
	let showFilters = $state(false);

	// Hidden until the browser says it was not dismissed, so a returning user
	// never sees it flash in.
	const ONBOARDING_DISMISSED_KEY = 'planner:onboarding-dismissed';
	let onboardingDismissed = $state(true);
	$effect(() => {
		try {
			onboardingDismissed =
				localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
		} catch {
			onboardingDismissed = false;
		}
	});
	let onboardingSteps = $derived(
		data.onboarding
			? buildOnboardingSteps(data.onboarding, data.reviewCount ?? null)
			: []
	);
	let showOnboarding = $derived(
		!onboardingDismissed && onboardingSteps.some((step) => !step.done)
	);
	function dismissOnboarding() {
		onboardingDismissed = true;
		try {
			localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
		} catch {
			// Private mode: it stays dismissed until the page reloads.
		}
	}
	let selection = $state<TreemapSelection | null>(null);
	// The selection detail is an aside from lg up and a Sheet below it.
	const LARGE_QUERY = '(min-width: 1024px)';
	let isLarge = $state(false);
	$effect(() => {
		const query = window.matchMedia(LARGE_QUERY);
		const sync = () => (isLarge = query.matches);
		sync();
		query.addEventListener('change', sync);
		return () => query.removeEventListener('change', sync);
	});

	let categoryTrend = $derived(
		data.categoryTrend ?? { months: [], series: [], points: [] }
	);
	let aboveNormal = $derived(data.aboveNormal ?? []);
	let savingsHistory = $derived(data.savingsHistory ?? []);
	let fixedVsVariable = $derived(
		data.fixedVsVariable ?? { fixedTotal: 0, variableTotal: 0, topFixed: [] }
	);
	let installmentForecast = $derived(
		data.installmentForecast ?? { months: [], totalCommitted: 0 }
	);
	let projection = $derived(data.projection ?? null);

	let currentSavings = $derived(
		savingsHistory.find((h) => h.month === selectedMonth) ?? null
	);
	let fixedShare = $derived.by(() => {
		const total = fixedVsVariable.fixedTotal + fixedVsVariable.variableTotal;
		return total > 0
			? Math.round((fixedVsVariable.fixedTotal / total) * 100)
			: 0;
	});
	let maxForecastTotal = $derived(
		Math.max(1, ...installmentForecast.months.map((m) => m.total))
	);

	let generatingInsights = $state(false);
	let insights = $derived(
		form?.insights && form?.insightsMonth === selectedMonth
			? form.insights
			: null
	);

	function insightsEnhance() {
		generatingInsights = true;
		return async ({
			update
		}: {
			update: (opts?: { reset?: boolean }) => Promise<void>;
		}) => {
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

	let drillDownTotal = $derived(
		drillDownTx.reduce((sum, tx) => sum + Math.abs(tx.amount), 0)
	);

	let monthSavings = $derived(
		(currentSavings?.credits ?? 0) - (currentSavings?.expenses ?? 0)
	);
	let showFixedVsVariable = $derived(
		fixedVsVariable.fixedTotal + fixedVsVariable.variableTotal > 0
	);
	let hasInvestmentFlows = $derived(
		Object.values(data.investmentFlows).some((value) => value !== 0)
	);
	let pendingText = $derived(
		[
			summary.needsReview > 0
				? `${summary.needsReview} ${summary.needsReview === 1 ? 'transação' : 'transações'} para revisar`
				: '',
			summary.uncategorized > 0 ? `${summary.uncategorized} sem categoria` : ''
		]
			.filter(Boolean)
			.join(' · ')
	);

	let expenseDelta = $derived(summary.expenses - previousSummary.expenses);
	let expenseDeltaPercent = $derived(
		previousSummary.expenses > 0
			? Math.round((expenseDelta / previousSummary.expenses) * 100)
			: null
	);

	function buildHref(
		params: Partial<{
			month: string;
			profile: string;
			category: string;
			review_status: string;
		}>
	) {
		const merged = {
			month: selectedMonth,
			profile: filters.profileId,
			category: filters.categoryId,
			review_status: filters.reviewStatus,
			...params
		};
		const qs = new SvelteURLSearchParams();
		for (const [k, v] of Object.entries(merged)) {
			if (v) qs.set(k, String(v));
		}
		const s = qs.toString();
		return s ? `/app?${s}` : '/app';
	}

	function transactionHref(flow?: string) {
		const qs = new SvelteURLSearchParams();
		if (selectedMonth) qs.set('month', selectedMonth);
		if (flow) qs.set('flow', flow);
		if (filters.profileId) qs.set('profile_id', filters.profileId);
		if (filters.categoryId) qs.set('category_id', filters.categoryId);
		if (filters.reviewStatus) qs.set('status', filters.reviewStatus);
		return `/app/transactions?${qs.toString()}` as `/app/transactions?${string}`;
	}

	function navigate(
		params: Partial<{
			month: string;
			profile: string;
			category: string;
			review_status: string;
		}>
	) {
		window.location.href = resolve(buildHref(params) as `/app?${string}`);
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
			<p class="text-sm font-medium tracking-wider text-text-muted uppercase">
				Visão geral
			</p>
			<h2 class="mt-1 text-2xl font-semibold text-text">
				{selectedMonth ? formatMonthLong(selectedMonth) : 'Sem dados'}
			</h2>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<label for="month-filter" class="sr-only">Mês</label>
			<select
				id="month-filter"
				class="min-h-11 rounded-md border-gray-300 bg-surface px-3 py-2 text-sm shadow-sm md:min-h-0"
				value={selectedMonth}
				onchange={(event) => navigate({ month: event.currentTarget.value })}
			>
				{#if monthOptions.length === 0}
					<option value="">Sem dados</option>
				{/if}
				{#each monthOptions as month (month)}
					<option value={month}>{formatMonthLong(month)}</option>
				{/each}
			</select>

			<button
				type="button"
				onclick={() => (showFilters = !showFilters)}
				class={`inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-2 text-sm shadow-sm transition md:min-h-0 ${hasActiveSecondaryFilter ? 'border-primary bg-primary-soft text-primary' : 'border-gray-300 bg-surface text-gray-700 hover:bg-canvas'}`}
				aria-expanded={showFilters}
			>
				<SlidersHorizontal class="h-4 w-4" />
				Filtros
				{#if hasActiveSecondaryFilter}
					<span
						class="ml-1 rounded-full bg-indigo-200 px-1.5 text-[10px] font-semibold text-indigo-800"
					>
						{[
							filters.profileId,
							filters.categoryId,
							filters.reviewStatus
						].filter(Boolean).length}
					</span>
				{/if}
			</button>
		</div>
	</div>

	{#if showFilters}
		<form
			method="GET"
			class="grid grid-cols-1 gap-3 rounded-lg bg-surface p-4 shadow sm:grid-cols-4"
		>
			<input type="hidden" name="month" value={selectedMonth} />
			<div>
				<label for="profile" class="block text-xs font-medium text-gray-600"
					>Perfil</label
				>
				<select
					id="profile"
					name="profile"
					class="mt-1 w-full rounded-md border-gray-300 px-2 py-1.5 text-sm"
				>
					<option value="">Todos</option>
					{#each profiles as p (p.id)}
						<option value={p.id} selected={p.id === filters.profileId}
							>{p.name}</option
						>
					{/each}
				</select>
			</div>
			<div>
				<label for="category" class="block text-xs font-medium text-gray-600"
					>Categoria</label
				>
				<select
					id="category"
					name="category"
					class="mt-1 w-full rounded-md border-gray-300 px-2 py-1.5 text-sm"
				>
					<option value="">Todas</option>
					{#each categories as c (c.id)}
						<option value={c.id} selected={c.id === filters.categoryId}
							>{c.name}</option
						>
					{/each}
				</select>
			</div>
			<div>
				<label
					for="review_status"
					class="block text-xs font-medium text-gray-600">Status</label
				>
				<select
					id="review_status"
					name="review_status"
					class="mt-1 w-full rounded-md border-gray-300 px-2 py-1.5 text-sm"
				>
					<option value="">Todos</option>
					<option
						value="needs_review"
						selected={filters.reviewStatus === 'needs_review'}>Revisar</option
					>
					<option
						value="confirmed"
						selected={filters.reviewStatus === 'confirmed'}>Confirmado</option
					>
					<option value="ignored" selected={filters.reviewStatus === 'ignored'}
						>Ignorado</option
					>
				</select>
			</div>
			<div class="flex items-end gap-2">
				<Button type="submit" size="sm">Aplicar</Button>
				{#if hasActiveSecondaryFilter}
					<a
						href={resolve(
							buildHref({
								profile: '',
								category: '',
								review_status: ''
							}) as `/app?${string}`
						)}
						class="text-xs text-text-muted underline hover:text-gray-700"
						>Limpar</a
					>
				{/if}
			</div>
		</form>
	{/if}

	{#if showOnboarding}
		<OnboardingChecklist
			steps={onboardingSteps}
			onDismiss={dismissOnboarding}
		/>
	{/if}

	{#if summary.count === 0}
		{#if !showOnboarding}
			<Card class="p-6">
				<div class="max-w-2xl">
					<h3 class="text-lg font-semibold text-text">
						Ainda não há dados para mostrar
					</h3>
					<p class="mt-2 text-sm text-gray-600">
						Importe uma fatura ou cadastre transações para liberar indicadores
						de gastos, revisão e categorias.
					</p>
					<div class="mt-4 flex flex-wrap gap-3">
						<Button href={resolve('/app/imports')}>Importar fatura</Button>
						<Button href={resolve('/app/transactions/new')} variant="secondary"
							>Nova transação</Button
						>
					</div>
				</div>
			</Card>
		{/if}
	{:else}
		{#if summary.needsReview > 0 || summary.uncategorized > 0}
			<a
				href={resolve('/app/review')}
				class="flex items-center gap-3 rounded-lg border border-warning/40 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100"
			>
				<AlertTriangle class="h-5 w-5 shrink-0 text-warning" />
				<span class="min-w-0 flex-1">
					{pendingText}
				</span>
				<span aria-hidden="true">→</span>
			</a>
		{/if}

		<section
			class="grid grid-cols-2 gap-3 md:gap-4 {projection
				? 'xl:grid-cols-4'
				: 'lg:grid-cols-3'}"
		>
			<StatTile
				label="Despesas"
				value={money(summary.expenses)}
				tone="expense"
				icon={CircleDollarSign}
				href={resolve(transactionHref('spending'))}
			>
				{#snippet hint()}
					{#if summary.refunds > 0}
						<p>Já descontados {money(summary.refunds)} de reembolsos</p>
					{/if}
					<p
						class="flex items-center gap-1 {expenseDelta <= 0
							? 'text-income'
							: 'text-expense'}"
					>
						{#if expenseDelta <= 0}
							<ArrowDownRight class="h-3.5 w-3.5" />
						{:else}
							<ArrowUpRight class="h-3.5 w-3.5" />
						{/if}
						{expenseDeltaPercent === null
							? 'Sem mês anterior'
							: `${Math.abs(expenseDeltaPercent)}% vs mês anterior`}
					</p>
				{/snippet}
			</StatTile>

			<StatTile
				label="Receitas"
				value={money(summary.credits)}
				tone="income"
				icon={ArrowUpRight}
				href={resolve(transactionHref('income'))}
			>
				{#snippet hint()}
					Saldo:
					<span class={summary.balance >= 0 ? 'text-income' : 'text-expense'}
						>{money(summary.balance)}</span
					>
				{/snippet}
			</StatTile>

			<StatTile
				label="Taxa de poupança"
				value={currentSavings?.rate != null
					? formatPercent(currentSavings.rate)
					: '—'}
				tone={currentSavings?.rate != null && currentSavings.rate < 0
					? 'expense'
					: 'neutral'}
				icon={PiggyBank}
			>
				{#snippet hint()}
					<p>Poupança do mês: {money(monthSavings)}</p>
					{#if savingsHistory.length > 1}
						<div class="mt-2 flex h-8 items-end gap-1" aria-hidden="true">
							{#each savingsHistory as h (h.month)}
								<div
									class={`min-w-0 flex-1 rounded-sm ${h.rate == null ? 'bg-gray-200' : h.rate >= 0 ? 'bg-income' : 'bg-expense'} ${h.month === selectedMonth ? '' : 'opacity-50'}`}
									style={`height: ${h.rate == null ? 6 : Math.max(6, Math.min(100, Math.abs(h.rate) * 100)) * 0.32}px`}
									title={`${shortMonthLabel(h.month)}: ${h.rate == null ? 'sem receitas' : formatPercent(h.rate)}`}
								></div>
							{/each}
						</div>
					{/if}
					<details class="mt-2">
						<summary
							class="inline-flex min-h-6 cursor-pointer items-center gap-1 text-primary"
						>
							<Info class="h-3.5 w-3.5" /> Como é calculada
						</summary>
						<p class="mt-1">
							(renda do trabalho − despesas líquidas) ÷ renda do trabalho.
							Reembolsos abatem despesas; proventos, aportes, resgates e
							transferências ficam fora.
						</p>
					</details>
				{/snippet}
			</StatTile>

			{#if projection}
				<StatTile
					label="Projeção do mês"
					value={money(projection.projected)}
					icon={CalendarClock}
				>
					{#snippet hint()}
						<p>nesse ritmo até o fim do mês</p>
						{#if projection.percentVsBaseline != null && projection.baseline != null}
							<p
								class={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${projection.percentVsBaseline > 5 ? 'bg-rose-50 text-expense' : 'bg-emerald-50 text-income'}`}
							>
								{#if projection.percentVsBaseline > 0}
									<ArrowUpRight class="h-3.5 w-3.5" />
								{:else}
									<ArrowDownRight class="h-3.5 w-3.5" />
								{/if}
								{Math.abs(projection.percentVsBaseline)}% vs média de {money(
									projection.baseline
								)}
							</p>
						{/if}
					{/snippet}
				</StatTile>
			{/if}
		</section>

		<Card
			title="Para onde foi o dinheiro"
			subtitle={selection
				? 'Clique fora ou em outro item para mudar o foco'
				: 'Clique em um item para ver as transações.'}
		>
			{#snippet actions()}
				<p class="text-lg font-semibold text-text tabular-nums">
					{money(totalExpenses)}
				</p>
			{/snippet}
			<div
				class={`grid gap-4 ${selection ? 'lg:grid-cols-[1fr_360px]' : 'grid-cols-1'}`}
			>
				<div class="hidden min-w-0 sm:block">
					<CategoryTreemap
						nodes={expenseHierarchy}
						height={460}
						selected={selection}
						onSelect={(s) => (selection = s)}
					/>
				</div>
				<div class="sm:hidden">
					<CategoryBars
						nodes={expenseHierarchy}
						selected={selection}
						onSelect={(s) => (selection = s)}
					/>
				</div>
				{#if selection}
					<aside
						class="hidden h-[460px] flex-col rounded-md border border-border bg-canvas lg:flex"
					>
						<div
							class="flex items-start justify-between border-b border-border bg-surface px-4 py-3"
						>
							<div class="min-w-0">
								<p class="text-[11px] tracking-wide text-text-muted uppercase">
									{selection.categoryName}
								</p>
								<p class="truncate text-sm font-semibold text-text">
									{selection.subcategoryName === selection.categoryName
										? 'Sem subcategoria'
										: selection.subcategoryName}
								</p>
								<p class="mt-0.5 text-xs text-text-muted">
									{drillDownTx.length}
									{drillDownTx.length === 1 ? 'transação' : 'transações'} · {money(
										drillDownTotal
									)}
								</p>
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
							{@render selectionList()}
						</div>
					</aside>
				{/if}
			</div>
		</Card>

		<section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
			<Card
				title="Fora do normal em {formatMonthLong(selectedMonth)}"
				subtitle="Comparado à média dos meses anteriores"
			>
				<div class="space-y-3">
					{#each aboveNormal as item (item.id)}
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium text-text">
									{item.name}
								</p>
								<p class="text-[11px] text-text-muted">
									{money(item.current)} vs média {money(item.baseline)}
								</p>
							</div>
							<span
								class={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${item.delta > 0 ? 'bg-rose-50 text-expense' : 'bg-emerald-50 text-income'}`}
							>
								{item.delta > 0 ? '+' : '−'}{money(
									Math.abs(item.delta)
								)}{item.deltaPercent != null
									? ` (${item.delta > 0 ? '+' : '−'}${Math.abs(item.deltaPercent)}%)`
									: ''}
							</span>
						</div>
					{/each}
					{#if aboveNormal.length === 0}
						<p class="text-xs text-text-muted">
							Nada fora do padrão — ou ainda não há meses anteriores suficientes
							para comparar.
						</p>
					{/if}
				</div>
			</Card>

			<Card
				title="Insights do mês"
				subtitle="Resumo gerado por IA a partir dos números de {formatMonthLong(
					selectedMonth
				)}"
			>
				{#snippet actions()}
					<form method="POST" action="?/insights" use:enhance={insightsEnhance}>
						<input type="hidden" name="month" value={selectedMonth} />
						<Button
							type="submit"
							size="sm"
							disabled={generatingInsights || !selectedMonth}
						>
							{#if generatingInsights}
								<span
									class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
									aria-hidden="true"
								></span>
								Gerando...
							{:else}
								<Sparkles class="h-3.5 w-3.5" />
								{insights ? 'Gerar novamente' : 'Gerar insights'}
							{/if}
						</Button>
					</form>
				{/snippet}
				{#if insights}
					<ul class="space-y-2.5">
						{#each insights as insight (insight)}
							<li class="flex items-start gap-2 text-sm text-gray-800">
								<span
									class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
									aria-hidden="true"
								></span>
								{insight}
							</li>
						{/each}
					</ul>
				{:else if form?.message && !form?.insights}
					<p class="text-sm text-expense">{form.message}</p>
				{:else if !generatingInsights}
					<p class="text-xs text-text-muted">
						Clique em "Gerar insights" para um resumo do que mudou neste mês:
						categorias fora do padrão, gastos novos e peso dos compromissos
						fixos.
					</p>
				{/if}
			</Card>
		</section>

		<section class="grid grid-cols-1 gap-4 xl:grid-cols-3">
			{#if categoryTrend.months.length >= 2}
				<Card
					class="xl:col-span-2"
					title="Evolução por categoria"
					subtitle="Despesas mensais das principais categorias (últimos {categoryTrend
						.months.length} meses)"
				>
					<CategoryTrendChart
						series={categoryTrend.series}
						points={categoryTrend.points}
					/>
				</Card>
			{/if}

			<Card
				class={categoryTrend.months.length >= 2 ? '' : 'xl:col-span-3'}
				title="Receitas vs despesas"
				subtitle="Últimos 6 meses"
			>
				<MonthlyTrendChart data={monthlyTrend} />
			</Card>
		</section>

		{#if installmentForecast.totalCommitted > 0}
			<Card
				title="Parcelas nos próximos meses"
				subtitle="{money(
					installmentForecast.totalCommitted
				)} já comprometidos em compras parceladas"
			>
				<div class="space-y-3">
					{#each installmentForecast.months as m (m.month)}
						<div>
							<div class="flex items-center justify-between gap-3 text-sm">
								<span class="text-gray-700 first-letter:uppercase"
									>{formatMonthLong(m.month)}</span
								>
								<span class="font-medium text-text tabular-nums"
									>{money(m.total)}
									<span class="text-xs font-normal text-text-muted"
										>· {m.count} {m.count === 1 ? 'parcela' : 'parcelas'}</span
									></span
								>
							</div>
							<div class="mt-1 h-2 rounded bg-gray-100">
								<div
									class="h-2 rounded bg-violet-500"
									style={`width: ${Math.round((m.total / maxForecastTotal) * 100)}%`}
								></div>
							</div>
						</div>
					{/each}
				</div>
			</Card>
		{/if}

		{#if showFixedVsVariable || hasInvestmentFlows}
			<section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
				{#if showFixedVsVariable}
					<Card title="Fixos vs variáveis">
						<p class="text-2xl font-semibold text-text tabular-nums">
							{fixedShare}%
							<span class="text-sm font-medium text-text-muted">fixos</span>
						</p>
						<div class="mt-2 flex h-2 overflow-hidden rounded bg-gray-100">
							<div class="h-2 bg-primary" style={`width: ${fixedShare}%`}></div>
						</div>
						<p class="mt-1 text-xs text-text-muted">
							{money(fixedVsVariable.fixedTotal)} recorrentes/parcelas · {money(
								fixedVsVariable.variableTotal
							)} variáveis
						</p>
						{#if fixedVsVariable.topFixed.length > 0}
							<ul class="mt-2 space-y-0.5 text-[11px] text-text-muted">
								{#each fixedVsVariable.topFixed.slice(0, 3) as item (item.name)}
									<li class="flex justify-between gap-2">
										<span class="truncate">{item.name}</span><span
											class="shrink-0">{money(item.total)}</span
										>
									</li>
								{/each}
							</ul>
						{/if}
					</Card>
				{/if}

				{#if hasInvestmentFlows}
					<Card title="Investimentos no mês">
						<ul class="space-y-1.5 text-sm text-gray-700">
							<li class="flex justify-between gap-3">
								<a
									class="hover:text-primary"
									href={resolve(transactionHref('contribution'))}>Aportes</a
								>
								<span class="tabular-nums"
									>{money(data.investmentFlows.contributions)}</span
								>
							</li>
							<li class="flex justify-between gap-3">
								<a
									class="hover:text-primary"
									href={resolve(transactionHref('redemption'))}>Resgates</a
								>
								<span class="tabular-nums"
									>{money(data.investmentFlows.redemptions)}</span
								>
							</li>
							<li class="flex justify-between gap-3">
								<span>Líquido</span>
								<span class="tabular-nums"
									>{money(data.investmentFlows.net)}</span
								>
							</li>
							<li class="flex justify-between gap-3">
								<a
									class="hover:text-primary"
									href={resolve(transactionHref('investment_income'))}
									>Proventos</a
								>
								<span class="tabular-nums"
									>{money(data.investmentFlows.investmentIncome)}</span
								>
							</li>
							<li class="flex justify-between gap-3 font-medium">
								<span>Capital novo investido</span>
								<span
									class="tabular-nums {data.investmentFlows.newCapital < 0
										? 'text-expense'
										: 'text-text'}"
									>{money(data.investmentFlows.newCapital)}</span
								>
							</li>
						</ul>
						<p class="mt-2 text-xs text-text-muted">
							Capital novo = aportes líquidos − proventos: reinvestir proventos
							não é poupança nova.
						</p>
					</Card>
				{/if}
			</section>
		{/if}

		<Card title="Transações recentes">
			<div class="overflow-x-auto rounded-md border border-gray-100">
				<table class="min-w-full divide-y divide-gray-100 text-sm">
					<tbody class="divide-y divide-gray-100">
						{#each recentTransactions as transaction (transaction.id)}
							<tr>
								<td class="px-3 py-2.5">
									<a
										href={resolve(`/app/transactions/${transaction.id}`)}
										class="font-medium text-text hover:text-primary"
										>{transaction.description}</a
									>
									<p class="mt-0.5 text-[11px] text-text-muted">
										{dateShort(transaction.date)} · {reviewStatusLabel(
											transaction.review_status
										)}
									</p>
								</td>
								<td
									class={`px-3 py-2.5 text-right text-sm font-medium tabular-nums ${transaction.amount < 0 ? 'text-expense' : 'text-income'}`}
								>
									{money(transaction.amount, transaction.currency ?? 'BRL')}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<a
				href={resolve(
					`/app/transactions?month=${encodeURIComponent(selectedMonth)}`
				)}
				class="mt-3 inline-block text-xs font-medium text-primary hover:text-primary-hover"
				>Ver todas →</a
			>
		</Card>

		{#if byProfile.length > 1 || byPayer.length > 1}
			<section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
				{#if byProfile.length > 1}
					<Card title="Por perfil">
						{@render shareRows(byProfile, 'bg-sky-500')}
					</Card>
				{/if}
				{#if byPayer.length > 1}
					<Card title="Por pagador">
						{@render shareRows(byPayer, 'bg-primary')}
					</Card>
				{/if}
			</section>
		{/if}
	{/if}
</div>

{#snippet shareRows(
	rows: { id: string; name: string; total: number; share: number }[],
	barClass: string
)}
	<div class="space-y-3">
		{#each rows as row (row.id)}
			<div>
				<div class="flex items-center justify-between gap-3 text-sm">
					<span class="truncate text-gray-700">{row.name}</span>
					<span class="font-medium text-text tabular-nums"
						>{money(row.total)}</span
					>
				</div>
				<div class="mt-1 flex items-center gap-2">
					<div class="h-2 flex-1 rounded bg-gray-100">
						<div
							class="h-2 rounded {barClass}"
							style={`width: ${row.share}%`}
						></div>
					</div>
					<span class="w-9 text-right text-xs text-text-muted"
						>{row.share}%</span
					>
				</div>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet selectionList()}
	{#if drillDownTx.length === 0}
		<p class="p-4 text-xs text-gray-500">Nenhuma transação para este item.</p>
	{:else}
		<ul class="divide-y divide-gray-100">
			{#each drillDownTx as tx (tx.id)}
				<li>
					<a
						href={resolve(`/app/transactions/${tx.id}`)}
						class="flex items-start justify-between gap-3 px-4 py-2.5 text-sm hover:bg-surface"
					>
						<div class="min-w-0">
							<p class="truncate font-medium text-gray-900">
								{tx.description}
							</p>
							<p class="text-[11px] text-gray-500">{dateShort(tx.date)}</p>
						</div>
						<span
							class={`shrink-0 text-sm font-medium ${tx.amount < 0 ? 'text-expense' : 'text-income'}`}
						>
							{money(tx.amount, tx.currency ?? 'BRL')}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

<Sheet
	open={!!selection && !isLarge}
	title={selection
		? selection.subcategoryName === selection.categoryName
			? selection.categoryName
			: `${selection.categoryName} · ${selection.subcategoryName}`
		: ''}
	onClose={() => (selection = null)}
>
	<p class="mb-2 text-xs text-gray-500">
		{drillDownTx.length}
		{drillDownTx.length === 1 ? 'transação' : 'transações'} · {money(
			drillDownTotal
		)}
	</p>
	{@render selectionList()}
</Sheet>
