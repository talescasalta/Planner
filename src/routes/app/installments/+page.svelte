<script lang="ts">
	import type { FutureInstallmentsSummary } from '$lib/types/installments';

	let { data }: { data: FutureInstallmentsSummary } = $props();
	let months = $derived(data.months ?? []);
	let total = $derived(data.total ?? 0);
	let count = $derived(data.count ?? 0);

	const brl = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL'
	});
	const MONTH_NAMES = [
		'jan',
		'fev',
		'mar',
		'abr',
		'mai',
		'jun',
		'jul',
		'ago',
		'set',
		'out',
		'nov',
		'dez'
	];

	function monthLabel(month: string): string {
		const [year, mm] = month.split('-');
		const name = MONTH_NAMES[Number(mm) - 1] ?? mm;
		return `${name}/${year}`;
	}
</script>

<div class="max-w-4xl mx-auto space-y-6">
	<div class="flex items-baseline justify-between gap-4">
		<h2 class="text-xl font-semibold text-gray-900">Parcelas futuras</h2>
		{#if count > 0}
			<div class="text-right">
				<div class="text-xs text-gray-500">Compromisso restante</div>
				<div class="text-lg font-semibold text-red-600">
					{brl.format(Math.abs(total))}
				</div>
			</div>
		{/if}
	</div>

	<p class="text-sm text-gray-500">
		Projeção das parcelas que ainda vão cair, calculada a partir dos marcadores
		<span class="font-mono">k/n</span> das faturas já importadas. Nenhuma transação
		futura é gravada; quando a fatura do mês chega, a parcela real substitui a projeção.
	</p>

	{#if months.length === 0}
		<div
			class="bg-white p-6 rounded-lg shadow text-sm text-gray-500 text-center"
		>
			Nenhuma parcela futura encontrada. Importe faturas de cartão com compras
			parceladas (descrições como <span class="font-mono">1/6</span> ou
			<span class="font-mono">Parcela 4/8</span>) para vê-las aqui.
		</div>
	{:else}
		{#each months as month (month.month)}
			<section class="bg-white rounded-lg shadow overflow-hidden">
				<header
					class="flex items-baseline justify-between px-4 py-2 bg-gray-50 border-b border-gray-100"
				>
					<h3 class="text-sm font-semibold text-gray-900 capitalize">
						{monthLabel(month.month)}
					</h3>
					<span class="text-sm font-medium text-red-600"
						>{brl.format(Math.abs(month.total))}</span
					>
				</header>
				<table class="min-w-full text-sm">
					<tbody class="divide-y divide-gray-100">
						{#each month.items as item (item.groupKey + '-' + item.number)}
							<tr>
								<td class="px-4 py-2 text-gray-900">{item.merchant}</td>
								<td class="px-4 py-2 text-gray-500 whitespace-nowrap">
									parcela {item.number}/{item.total}
								</td>
								<td class="px-4 py-2 text-gray-500"
									>{item.categoryName ?? '—'}</td
								>
								<td
									class="px-4 py-2 text-right text-gray-900 whitespace-nowrap"
								>
									{brl.format(Math.abs(item.amount))}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/each}
	{/if}
</div>
