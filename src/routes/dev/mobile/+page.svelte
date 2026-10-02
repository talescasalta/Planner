<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppLayout from '../../app/+layout.svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import CategoriesPage from '../../app/categories/+page.svelte';
	import RulesPage from '../../app/rules/+page.svelte';
	import InstallmentsPage from '../../app/installments/+page.svelte';
	import DashboardPage from '../../app/+page.svelte';
	import AppliedVsGrossChart from '$lib/components/charts/AppliedVsGrossChart.svelte';
	import ImportsPage from '../../app/imports/+page.svelte';
	import NewTransactionPage from '../../app/transactions/new/+page.svelte';
	import TransactionsPage from '../../app/transactions/+page.svelte';
	import { appliedVsGrossData, dashboardData } from './dashboard-fixture';
	import {
		importsData,
		importsForm,
		newTransactionData
	} from './forms-fixture';
	import { transactionsData } from './transactions-fixture';
	import {
		categoriesData,
		installmentsData,
		layoutData,
		rulesData
	} from './fixtures';

	const VIEWS = [
		'layout',
		'sheet',
		'categories',
		'rules',
		'installments',
		'transactions'
	];
	const NOTICE =
		'Vitrine só visual (apenas em desenvolvimento): os formulários não devem ser enviados.';

	const view = $derived(page.url.searchParams.get('view') ?? 'layout');
	let sheetOpen = $state(true);
</script>

<AppLayout data={layoutData}>
	<div class="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
		<p class="text-amber-900">{NOTICE}</p>
		<ul class="mt-2 flex flex-wrap gap-3">
			{#each VIEWS as name (name)}
				<li>
					<a
						href="{resolve('/dev/mobile')}?view={name}"
						class="text-indigo-700 underline {view === name
							? 'font-semibold'
							: ''}">{name}</a
					>
				</li>
			{/each}
		</ul>
	</div>

	{#if view === 'categories'}
		<CategoriesPage data={categoriesData} />
	{:else if view === 'rules'}
		<RulesPage data={rulesData} />
	{:else if view === 'installments'}
		<InstallmentsPage data={installmentsData} />
	{:else if view === 'transactions'}
		<TransactionsPage data={transactionsData} />
	{:else if view === 'dashboard'}
		<DashboardPage data={dashboardData} form={null} />
	{:else if view === 'chart'}
		<div class="rounded-lg bg-white p-4 shadow">
			<AppliedVsGrossChart data={appliedVsGrossData} />
		</div>
	{:else if view === 'new-transaction'}
		<NewTransactionPage data={newTransactionData} />
	{:else if view === 'imports'}
		<ImportsPage data={importsData} form={importsForm} />
	{:else if view === 'sheet'}
		<button
			type="button"
			class="min-h-11 rounded bg-indigo-600 px-4 text-sm text-white"
			onclick={() => (sheetOpen = true)}>Abrir folha</button
		>
		<Sheet open={sheetOpen} title="Exemplo" onClose={() => (sheetOpen = false)}>
			<label class="block text-sm text-gray-700">
				Campo de exemplo
				<input
					type="text"
					class="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
				/>
			</label>
			<p class="mt-4 text-sm text-gray-600">Conteúdo de exemplo da folha.</p>
		</Sheet>
	{/if}
</AppLayout>
