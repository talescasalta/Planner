<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import AppLayout from '../../app/+layout.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import Sheet from '$lib/components/ui/Sheet.svelte';
	import StatTile from '$lib/components/ui/StatTile.svelte';
	import { brl } from '$lib/format';
	import { toast } from '$lib/toast.svelte';
	import CategoriesPage from '../../app/categories/+page.svelte';
	import RulesPage from '../../app/rules/+page.svelte';
	import InstallmentsPage from '../../app/installments/+page.svelte';
	import DashboardPage from '../../app/+page.svelte';
	import AppliedVsGrossChart from '$lib/components/charts/AppliedVsGrossChart.svelte';
	import ImportsPage from '../../app/imports/+page.svelte';
	import NewTransactionPage from '../../app/transactions/new/+page.svelte';
	import TransactionsPage from '../../app/transactions/+page.svelte';
	import {
		appliedVsGrossData,
		dashboardData,
		dashboardEmptyData,
		dashboardNewData
	} from './dashboard-fixture';
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
		'ui',
		'dashboard',
		'dashboard-empty',
		'dashboard-new',
		'empty-states',
		'categories',
		'rules',
		'installments',
		'transactions'
	];
	const NOTICE =
		'Vitrine só visual (apenas em desenvolvimento): os formulários não devem ser enviados.';

	const view = $derived(page.url.searchParams.get('view') ?? 'layout');
	let sheetOpen = $state(true);
	let confirmOpen = $state(false);
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
	{:else if view === 'dashboard-empty'}
		<DashboardPage data={dashboardEmptyData} form={null} />
	{:else if view === 'dashboard-new'}
		<DashboardPage data={dashboardNewData} form={null} />
	{:else if view === 'empty-states'}
		<div class="space-y-10">
			<TransactionsPage
				data={{ ...transactionsData, transactions: [], monthOptions: [] }}
			/>
			<InstallmentsPage data={{ ...installmentsData, months: [] }} />
			<RulesPage data={{ ...rulesData, rules: [] }} />
		</div>
	{:else if view === 'chart'}
		<div class="rounded-lg bg-surface p-4 shadow">
			<AppliedVsGrossChart data={appliedVsGrossData} />
		</div>
	{:else if view === 'new-transaction'}
		<NewTransactionPage data={newTransactionData} />
	{:else if view === 'imports'}
		<ImportsPage data={importsData} form={importsForm} />
	{:else if view === 'ui'}
		<div class="space-y-6">
			<Card title="Botões" subtitle="primary, secondary, ghost, danger e sm">
				<div class="flex flex-wrap gap-2">
					<Button>Primário</Button>
					<Button variant="secondary">Secundário</Button>
					<Button variant="ghost">Fantasma</Button>
					<Button variant="danger">Perigo</Button>
					<Button size="sm">Pequeno</Button>
					<Button disabled>Desativado</Button>
					<Button href={resolve('/dev/mobile') + '?view=ui'}>Link</Button>
				</div>
			</Card>
			<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
				<StatTile label="Despesas" value={brl(4321.5)} tone="expense">
					{#snippet hint()}12% a mais que o mês anterior{/snippet}
				</StatTile>
				<StatTile label="Receitas" value={brl(8000)} tone="income" />
				<StatTile label="Saldo" value={brl(3678.5)} />
				<StatTile
					label="Revisão"
					value="7"
					href={resolve('/dev/mobile') + '?view=ui'}
				/>
			</div>
			<Card title="Diálogo e avisos">
				{#snippet actions()}
					<Button size="sm" variant="secondary">Ação</Button>
				{/snippet}
				<div class="flex flex-wrap gap-2">
					<Button variant="danger" onclick={() => (confirmOpen = true)}
						>Abrir confirmação</Button
					>
					<Button variant="secondary" onclick={() => toast.success('Salvo')}
						>Toast de sucesso</Button
					>
					<Button
						variant="secondary"
						onclick={() => toast.error('Não foi possível salvar')}
						>Toast de erro</Button
					>
					<Button
						variant="secondary"
						onclick={() =>
							toast.info('Transação excluída', {
								action: { label: 'Desfazer', onClick: () => {} }
							})}>Toast com ação</Button
					>
				</div>
			</Card>
			<ConfirmDialog
				open={confirmOpen}
				title="Excluir 12 transações?"
				message="Todas as transações de setembro de 2026 serão removidas."
				confirmLabel="Excluir"
				onConfirm={() => (confirmOpen = false)}
				onCancel={() => (confirmOpen = false)}
			/>
		</div>
	{:else if view === 'sheet'}
		<button
			type="button"
			class="min-h-11 rounded bg-primary px-4 text-sm text-white"
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
