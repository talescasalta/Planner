<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { brl, dateBr, money } from '$lib/format';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let importing = $state(false);
	let reading = $state(false);
	let saving = $state(false);

	// What the print reader found, bound to the form below so the numbers are
	// reviewed before anything is saved.
	let formAsset = $state('');
	let formBalance = $state('');
	let formRate = $state('');
	let formDate = $state('');

	$effect(() => {
		if (!form || !('read' in form) || !form.read) return;
		const line =
			form.balances.find((b) =>
				data.holdings.some((h) => h.currency === b.currency)
			) ?? form.balances[0];
		const match = data.holdings.find((h) => h.currency === line.currency);
		formAsset = match?.id ?? '';
		formBalance = String(line.balance);
		formRate = line.ratePercent === null ? '' : String(line.ratePercent);
		formDate = form.today;
	});

	$effect(() => {
		if (!formAsset && data.holdings.length > 0) formAsset = data.holdings[0].id;
	});

	const units = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
	const ratePct = (value: number | null) =>
		value === null
			? '—'
			: `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% a.a.`;

	let message = $derived(form && 'message' in form ? form.message : null);
</script>

<svelte:head>
	<title>Investimentos no exterior</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6 p-4">
	<div>
		<h2 class="text-sm font-semibold text-gray-900">Exterior</h2>
		<p class="mt-1 text-sm text-gray-600">
			O saldo do Rende+ da Wise é aplicado num fundo de liquidez em dólar. O
			extrato informa quantas cotas existem; o print do app informa quanto elas
			valem hoje e a taxa variável. Entre um e outro, o app atualiza a cota pela
			taxa e converte para reais pela PTAX do dia.
		</p>
		<p class="mt-1 text-xs text-gray-500">
			Rendimento no exterior é declarado no ajuste anual (Lei 14.754/2023): não
			entra em
			<a class="underline" href={resolve('/app/investments/taxes')}
				>IR a recolher</a
			>.
		</p>
	</div>

	{#if message}
		<div
			class={form?.success
				? 'rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900'
				: 'rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800'}
		>
			{message}
		</div>
	{/if}

	{#if data.holdings.length > 0}
		<div class="overflow-x-auto rounded-lg border border-gray-200 bg-surface">
			<table class="w-full text-sm">
				<thead class="bg-gray-50 text-left text-xs text-gray-500">
					<tr>
						<th class="px-3 py-2 font-medium">Saldo</th>
						<th class="px-3 py-2 text-right font-medium">Cotas</th>
						<th class="px-3 py-2 text-right font-medium">Valor</th>
						<th class="px-3 py-2 text-right font-medium">Em reais</th>
						<th class="px-3 py-2 text-right font-medium">Taxa</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each data.holdings as holding (holding.id)}
						<tr>
							<td class="px-3 py-2">
								<p class="font-medium text-gray-900">{holding.name}</p>
								<p class="text-xs text-gray-500">
									{holding.isin ?? ''}
									{#if holding.anchorDate}· última leitura Wise {dateBr(
											holding.anchorDate
										)}{/if}
								</p>
							</td>
							<td class="px-3 py-2 text-right tabular-nums">
								{units.format(holding.units)}
								{#if holding.nativePrice !== null}
									<p class="text-xs text-gray-500">
										× {money(holding.nativePrice, holding.currency)}
									</p>
								{/if}
							</td>
							<td class="px-3 py-2 text-right tabular-nums">
								{holding.nativeValue === null
									? '—'
									: money(holding.nativeValue, holding.currency)}
								<p class="text-xs text-gray-500">
									aportado {money(holding.nativeInvested, holding.currency)}
								</p>
							</td>
							<td class="px-3 py-2 text-right tabular-nums">
								{holding.value === null ? '—' : brl(holding.value)}
								{#if holding.fx !== null && holding.priceDate}
									<p class="text-xs text-gray-500">
										PTAX {holding.fx.toLocaleString('pt-BR', {
											maximumFractionDigits: 4
										})} · {dateBr(holding.priceDate)}
									</p>
								{/if}
							</td>
							<td class="px-3 py-2 text-right tabular-nums">
								{ratePct(holding.ratePercent)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="rounded-lg border border-gray-200 bg-surface p-4">
		<h2 class="text-sm font-semibold text-gray-900">
			Importar extrato da Wise
		</h2>
		<p class="mt-1 text-xs text-gray-500">
			No site da Wise: Extratos → escolha o período → CSV. Envie o .zip como
			veio (ou um dos .csv). Só os movimentos do Rende+ são lidos; reenviar um
			período já importado não duplica nada. Para começar, importe o período em
			que o Rende+ foi ativado.
		</p>
		<form
			method="POST"
			action="?/import_statement"
			enctype="multipart/form-data"
			use:enhance={() => {
				importing = true;
				return async ({ update }) => {
					importing = false;
					await update();
				};
			}}
			class="mt-3 flex flex-wrap items-center gap-3"
		>
			<input
				name="statement"
				type="file"
				accept=".zip,.csv,application/zip,text/csv"
				required
				class="block text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm"
			/>
			<button
				type="submit"
				disabled={importing}
				class="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
			>
				{importing ? 'Importando…' : 'Importar extrato'}
			</button>
		</form>
	</div>

	<div class="rounded-lg border border-gray-200 bg-surface p-4">
		<h2 class="text-sm font-semibold text-gray-900">Atualizar pelo print</h2>
		{#if data.holdings.length === 0}
			<p class="mt-1 text-xs text-gray-500">
				Importe um extrato primeiro: é ele que diz quantas cotas existem.
			</p>
		{:else}
			<p class="mt-1 text-xs text-gray-500">
				Mande o print da tela do Rende+. O app lê o saldo em moeda estrangeira e
				a taxa variável e preenche o formulário para você conferir. O total em
				reais da Wise é ignorado: a conversão usa a PTAX.
			</p>
			<form
				method="POST"
				action="?/read_print"
				enctype="multipart/form-data"
				use:enhance={() => {
					reading = true;
					return async ({ update }) => {
						reading = false;
						await update({ reset: false });
					};
				}}
				class="mt-3 flex flex-wrap items-center gap-3"
			>
				<input
					name="print"
					type="file"
					accept="image/*"
					required
					class="block text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm"
				/>
				<button
					type="submit"
					disabled={reading}
					class="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
				>
					{reading ? 'Lendo…' : 'Ler print'}
				</button>
			</form>
			{#if form && 'notes' in form && form.notes}
				<p class="mt-2 text-xs text-amber-700">{form.notes}</p>
			{/if}

			<form
				method="POST"
				action="?/save_balance"
				use:enhance={() => {
					saving = true;
					return async ({ update }) => {
						saving = false;
						await update();
					};
				}}
				class="mt-4 grid gap-3 sm:grid-cols-4"
			>
				<label class="text-xs text-gray-600 sm:col-span-4">
					Saldo
					<select
						name="asset_id"
						bind:value={formAsset}
						class="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
					>
						{#each data.holdings as holding (holding.id)}
							<option value={holding.id}>{holding.name}</option>
						{/each}
					</select>
				</label>
				<label class="text-xs text-gray-600">
					Saldo na moeda
					<input
						name="balance"
						inputmode="decimal"
						required
						bind:value={formBalance}
						placeholder="27247,71"
						class="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
					/>
				</label>
				<label class="text-xs text-gray-600">
					Taxa variável (% a.a.)
					<input
						name="rate"
						inputmode="decimal"
						bind:value={formRate}
						placeholder="3,61"
						class="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
					/>
				</label>
				<label class="text-xs text-gray-600">
					Data do saldo
					<input
						name="date"
						type="date"
						required
						bind:value={formDate}
						class="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
					/>
				</label>
				<div class="flex items-end">
					<button
						type="submit"
						disabled={saving}
						class="w-full rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
					>
						{saving ? 'Salvando…' : 'Salvar saldo'}
					</button>
				</div>
			</form>
		{/if}
	</div>
</div>
