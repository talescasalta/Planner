<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const brl = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL'
	});
	const BUCKET_LABELS: Record<string, string> = {
		fii: 'FII (20%)',
		acoes: 'Ações (15%)',
		etf_rv: 'ETF RV (15%)'
	};

	let paidByMonth = $derived(
		new Map(
			data.darfStatus.map((status) => [status.reference_month, status.paid])
		)
	);
	let monthsDesc = $derived([...data.months].reverse());
	let overrideAssetId = $state('');
</script>

<svelte:head>
	<title>IR a recolher</title>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6 p-4">
	<div>
		<h2 class="text-sm font-semibold text-gray-900">
			IR a recolher — investimentos
		</h2>
		<p class="mt-1 text-sm text-gray-600">
			Apuração mensal das suas vendas (por CPF) nas cestas FII, ações e ETFs de
			renda variável. Tesouro, CDB e ETFs de renda fixa têm imposto retido na
			fonte; LCA/LCI e rendimentos de FII são isentos — nada disso gera DARF.
		</p>
		<p class="mt-1 text-xs text-gray-500">
			Cálculo segundo as regras vigentes (DARF 6015, mínimo de R$ 10, isenção de
			R$ 20 mil para ações). Ferramenta de apoio — não substitui contador.
		</p>
	</div>

	{#if form && form.success === false}
		<div
			class="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
		>
			{form.message}
		</div>
	{/if}

	{#if data.months.length === 0}
		<div
			class="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500"
		>
			Nenhuma venda tributável encontrada.
			<a
				class="text-blue-700 underline"
				href={resolve('/app/investments/import')}
			>
				Importe negociações e movimentações da B3</a
			> para calcular a apuração.
		</div>
	{:else}
		<div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
			<table class="w-full text-left text-sm">
				<thead>
					<tr class="border-b bg-gray-50 text-xs text-gray-500">
						<th class="px-3 py-2">Mês</th>
						<th class="px-3 py-2">Cestas</th>
						<th class="px-3 py-2 text-right">Imposto do mês</th>
						<th class="px-3 py-2 text-right">DARF</th>
						<th class="px-3 py-2">Vencimento</th>
						<th class="px-3 py-2">Pago?</th>
					</tr>
				</thead>
				<tbody>
					{#each monthsDesc as taxMonth (taxMonth.month)}
						<tr class="border-b border-gray-100 align-top">
							<td class="px-3 py-2 font-medium whitespace-nowrap"
								>{taxMonth.month}</td
							>
							<td class="px-3 py-2">
								{#each Object.entries(taxMonth.buckets) as [bucket, detail] (bucket)}
									<div class="text-xs">
										<span class="font-medium"
											>{BUCKET_LABELS[bucket] ?? bucket}:</span
										>
										vendas {brl.format(detail.grossSales)}, resultado {brl.format(
											detail.gain
										)}{#if detail.exempt}
											<span class="text-emerald-700"
												>(isento — vendas ≤ R$ 20 mil)</span
											>{/if}{#if detail.lossOffset > 0}
											· compensou {brl.format(detail.lossOffset)} de prejuízo{/if}
									</div>
								{/each}
							</td>
							<td class="px-3 py-2 text-right whitespace-nowrap"
								>{brl.format(taxMonth.taxDue)}</td
							>
							<td class="px-3 py-2 text-right whitespace-nowrap">
								{#if taxMonth.darfAmount > 0}
									<span class="font-semibold"
										>{brl.format(taxMonth.darfAmount)}</span
									>
								{:else if taxMonth.taxDue > 0}
									<span class="text-xs text-gray-500"
										>abaixo de R$ 10 — acumula ({brl.format(
											taxMonth.carriedIntoNext
										)})</span
									>
								{:else}
									—
								{/if}
							</td>
							<td class="px-3 py-2 whitespace-nowrap">{taxMonth.dueDate}</td>
							<td class="px-3 py-2">
								{#if taxMonth.darfAmount > 0}
									<form method="POST" action="?/mark_paid" use:enhance>
										<input type="hidden" name="month" value={taxMonth.month} />
										<input
											type="hidden"
											name="amount"
											value={taxMonth.darfAmount}
										/>
										<input
											type="hidden"
											name="paid"
											value={paidByMonth.get(taxMonth.month) ? 'false' : 'true'}
										/>
										<button
											type="submit"
											class={paidByMonth.get(taxMonth.month)
												? 'rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-800'
												: 'rounded bg-amber-100 px-2 py-1 text-xs text-amber-800 hover:bg-amber-200'}
										>
											{paidByMonth.get(taxMonth.month)
												? '✓ pago'
												: 'marcar pago'}
										</button>
									</form>
								{:else}
									<span class="text-xs text-gray-400">—</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if data.carryforward && (data.carryforward.fii > 0 || data.carryforward.acoes > 0 || data.carryforward.etf_rv > 0)}
			<div
				class="rounded border border-gray-200 bg-white p-3 text-xs text-gray-600"
			>
				Prejuízo acumulado a compensar:
				{#each Object.entries(data.carryforward).filter(([, value]) => value > 0) as [bucket, value] (bucket)}
					<span class="mr-3"
						>{BUCKET_LABELS[bucket] ?? bucket}: {brl.format(value)}</span
					>
				{/each}
			</div>
		{/if}
	{/if}

	<div class="rounded-lg border border-gray-200 bg-white p-4">
		<h2 class="text-sm font-semibold text-gray-900">Custo inicial manual</h2>
		<p class="mt-1 text-xs text-gray-500">
			Para ativos comprados antes do histórico disponível na B3: informe
			quantidade e custo total na data de corte para que o preço médio (e o IR)
			saiam corretos.
		</p>
		<form
			method="POST"
			action="?/set_override"
			use:enhance
			class="mt-3 flex flex-wrap items-end gap-3"
		>
			<label class="text-xs text-gray-600">
				Ativo
				<select
					name="asset_id"
					bind:value={overrideAssetId}
					required
					class="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
				>
					<option value="" disabled>Selecione…</option>
					{#each data.assets as asset (asset.id)}
						<option value={asset.id}>
							{asset.label}{asset.override_quantity !== null
								? ' (tem override)'
								: ''}
						</option>
					{/each}
				</select>
			</label>
			<label class="text-xs text-gray-600">
				Quantidade
				<input
					name="quantity"
					type="number"
					step="any"
					required
					class="mt-1 block w-28 rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Custo total (R$)
				<input
					name="total_cost"
					type="number"
					step="any"
					required
					class="mt-1 block w-32 rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Data de corte
				<input
					name="date"
					type="date"
					class="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<button
				type="submit"
				class="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
			>
				Salvar
			</button>
		</form>
	</div>
</div>
