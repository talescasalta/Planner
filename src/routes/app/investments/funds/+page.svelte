<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);

	const brl = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL'
	});
	const CLASS_LABELS: Record<string, string> = {
		fundo: 'Fundo',
		previdencia: 'Previdência'
	};

	let total = $derived(data.funds.reduce((sum, f) => sum + (f.value ?? 0), 0));
</script>

<svelte:head>
	<title>Fundos e previdência</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6 p-4">
	<div>
		<h1 class="text-xl font-semibold text-gray-900">Fundos e previdência</h1>
		<p class="mt-1 text-sm text-gray-600">
			Fundos abertos e planos PGBL/VGBL não ficam em custódia na B3, então não
			vêm nos arquivos de importação. Cadastre pelo CNPJ e o app passa a
			atualizar a cota diariamente pelo informe da CVM.
		</p>
		<p class="mt-1 text-xs text-gray-500">
			Imposto retido na fonte (come-cotas ou tabela regressiva): entram no
			patrimônio, não geram DARF em
			<a class="underline" href={resolve('/app/investments/taxes')}
				>IR a recolher</a
			>.
		</p>
	</div>

	{#if form}
		<div
			class={form.success
				? 'rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900'
				: 'rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800'}
		>
			{form.message}
		</div>
	{/if}

	<div class="rounded-lg border border-gray-200 bg-white p-4">
		<h2 class="text-sm font-semibold text-gray-900">Cadastrar fundo</h2>
		<p class="mt-1 text-xs text-gray-500">
			Copie saldo e rendimento da tela do fundo no app da corretora. As cotas
			são calculadas dividindo o saldo pela cota oficial do dia — você não
			precisa digitá-las.
		</p>
		<form
			method="POST"
			action="?/add"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
			class="mt-3 grid gap-3 sm:grid-cols-2"
		>
			<label class="text-xs text-gray-600">
				Nome do fundo
				<input
					name="name"
					required
					placeholder="Kinea Atlas II FIM RL - Subclasse I"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				CNPJ
				<input
					name="cnpj"
					required
					placeholder="29.762.315/0001-58"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Subclasse CVM <span class="text-gray-400">(só se o fundo tiver)</span>
				<input
					name="subclass"
					placeholder="30SMU1746554429"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Tipo
				<select
					name="asset_class"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				>
					<option value="fundo">Fundo de investimento</option>
					<option value="previdencia">Previdência (PGBL/VGBL)</option>
				</select>
			</label>
			<label class="text-xs text-gray-600">
				Saldo atual (R$)
				<input
					name="balance"
					required
					inputmode="decimal"
					placeholder="18302,57"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Rendimento acumulado (R$)
				<input
					name="gain"
					required
					inputmode="decimal"
					placeholder="9162,23"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Data do saldo
				<input
					name="balance_date"
					type="date"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Início da aplicação <span class="text-gray-400">(opcional)</span>
				<input
					name="start_date"
					type="date"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
				<span class="mt-1 block text-gray-400">
					Sem ela o fundo entra no patrimônio, mas fica fora do % do CDI.
				</span>
			</label>
			<div class="sm:col-span-2">
				<button
					type="submit"
					disabled={submitting}
					class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
				>
					{submitting ? 'Buscando cota na CVM…' : 'Cadastrar'}
				</button>
			</div>
		</form>
	</div>

	<div class="rounded-lg border border-gray-200 bg-white p-4">
		<div class="mb-2 flex items-baseline justify-between">
			<h2 class="text-sm font-semibold text-gray-900">Cadastrados</h2>
			{#if data.funds.length > 0}
				<span class="text-sm font-medium text-gray-900"
					>{brl.format(total)}</span
				>
			{/if}
		</div>
		{#if data.funds.length === 0}
			<p class="py-6 text-center text-sm text-gray-500">
				Nenhum fundo cadastrado.
			</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b text-xs text-gray-500">
							<th class="py-1 pr-2">Fundo</th>
							<th class="py-1 pr-2 text-right">Cotas</th>
							<th class="py-1 pr-2 text-right">Cota</th>
							<th class="py-1 pr-2 text-right">Valor</th>
							<th class="py-1 pr-2 text-right">Investido</th>
							<th class="py-1"></th>
						</tr>
					</thead>
					<tbody>
						{#each data.funds as fund (fund.id)}
							<tr class="border-b border-gray-100">
								<td class="py-1 pr-2">
									<span class="font-medium text-gray-900">{fund.name}</span>
									<span class="block text-xs text-gray-500">
										{CLASS_LABELS[fund.assetClass] ?? fund.assetClass} · {fund.cnpj}
										{#if !fund.investedDate}
											· <span class="text-amber-700">sem data de início</span>
										{/if}
									</span>
								</td>
								<td class="py-1 pr-2 text-right"
									>{fund.quantity.toLocaleString('pt-BR', {
										maximumFractionDigits: 2
									})}</td
								>
								<td class="py-1 pr-2 text-right">
									{fund.quota === null ? '—' : fund.quota.toFixed(6)}
									{#if fund.quotaDate}
										<span class="block text-[10px] text-gray-400"
											>{fund.quotaDate}</span
										>
									{/if}
								</td>
								<td class="py-1 pr-2 text-right font-medium"
									>{fund.value === null ? '—' : brl.format(fund.value)}</td
								>
								<td class="py-1 pr-2 text-right text-gray-600"
									>{fund.invested === null
										? '—'
										: brl.format(fund.invested)}</td
								>
								<td class="py-1 text-right">
									<form method="POST" action="?/remove" use:enhance>
										<input type="hidden" name="asset_id" value={fund.id} />
										<button
											type="submit"
											class="text-xs text-red-600 hover:text-red-800"
											>remover</button
										>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
