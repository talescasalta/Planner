<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let submitting = $state(false);
	let reading = $state(false);

	let extracted = $derived(form?.extracted ?? []);

	// Values the screenshot reader filled in, bound to the manual form so the
	// user reviews and edits them before anything is saved.
	let formName = $state('');
	let formCnpj = $state('');
	let formSubclass = $state('');
	let formKind = $state('fundo');
	let formBalance = $state('');
	let formGain = $state('');
	let formBalanceDate = $state('');

	function useExtracted(
		fund: {
			name: string;
			balance: number;
			applied: number | null;
			balanceDate: string | null;
			kind: string;
		},
		cnpj: string,
		subclassId: string
	) {
		formName = fund.name;
		formCnpj = cnpj;
		formSubclass = subclassId;
		formKind = fund.kind;
		formBalance = String(fund.balance);
		// The form asks for the gain; the screenshot may have given the cost.
		formGain = fund.applied === null ? '' : String(fund.balance - fund.applied);
		formBalanceDate = fund.balanceDate ?? '';
		document.getElementById('name')?.scrollIntoView({ behavior: 'smooth' });
	}

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
		<h2 class="text-sm font-semibold text-gray-900">Fundos e previdência</h2>
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
		<h2 class="text-sm font-semibold text-gray-900">Ler de um print</h2>
		<p class="mt-1 text-xs text-gray-500">
			Mande a tela do fundo no app da corretora (PNG, JPEG, WebP ou PDF com
			texto). O app extrai saldo e valor aplicado e preenche o formulário abaixo
			para você conferir — nada é salvo sem sua confirmação.
		</p>
		<form
			method="POST"
			action="?/read_screenshot"
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
				name="screenshot"
				type="file"
				accept="image/*,application/pdf"
				required
				class="block text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm"
			/>
			<button
				type="submit"
				disabled={reading}
				class="rounded bg-gray-800 px-3 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
			>
				{reading ? 'Lendo…' : 'Ler print'}
			</button>
		</form>

		{#if extracted.length > 0}
			<div class="mt-3 space-y-2">
				{#if form?.notes}
					<p class="text-xs text-amber-700">{form.notes}</p>
				{/if}
				{#each extracted as fund, index (index)}
					<div class="rounded border border-gray-200 p-3 text-xs">
						<p class="font-medium text-gray-900">{fund.name}</p>
						<p class="text-gray-600">
							Saldo {brl.format(fund.balance)}
							{#if fund.applied !== null}· aplicado {brl.format(
									fund.applied
								)}{/if}
							{#if fund.balanceDate}· em {fund.balanceDate}{/if}
							· {CLASS_LABELS[fund.kind] ?? fund.kind}
						</p>
						{#if fund.cnpj}
							<p class="mt-1 text-gray-500">CNPJ lido do print: {fund.cnpj}</p>
							<button
								type="button"
								class="mt-2 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
								onclick={() => useExtracted(fund, fund.cnpj ?? '', '')}
							>
								Usar no formulário
							</button>
						{:else if fund.candidates.length > 0}
							<p class="mt-1 text-gray-500">
								O print não mostra o CNPJ. Escolha o fundo no cadastro da CVM:
							</p>
							<ul class="mt-1 space-y-1">
								{#each fund.candidates as candidate (candidate.cnpj + candidate.subclassId)}
									<li>
										<button
											type="button"
											class="text-left text-blue-700 underline"
											onclick={() =>
												useExtracted(
													fund,
													candidate.cnpj,
													candidate.subclassId
												)}
										>
											{candidate.name}
											<span class="text-gray-500">
												— {candidate.cnpj}{candidate.subclassId
													? ` · subclasse ${candidate.subclassId}`
													: ''}</span
											>
										</button>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="mt-1 text-amber-700">
								Não achei esse fundo no cadastro da CVM pelo nome. Preencha o
								CNPJ no formulário abaixo.
							</p>
							<button
								type="button"
								class="mt-2 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
								onclick={() => useExtracted(fund, '', '')}
							>
								Usar os valores no formulário
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

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
					id="name"
					name="name"
					bind:value={formName}
					required
					placeholder="Kinea Atlas II FIM RL - Subclasse I"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				CNPJ
				<input
					name="cnpj"
					bind:value={formCnpj}
					required
					placeholder="29.762.315/0001-58"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Subclasse CVM <span class="text-gray-400">(só se o fundo tiver)</span>
				<input
					name="subclass"
					bind:value={formSubclass}
					placeholder="30SMU1746554429"
					class="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
				/>
			</label>
			<label class="text-xs text-gray-600">
				Tipo
				<select
					name="asset_class"
					bind:value={formKind}
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
					bind:value={formBalance}
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
					bind:value={formGain}
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
					bind:value={formBalanceDate}
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
