<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let selectedFile: File | null = $state(null);
	let isSubmitting = $state(false);
	let confirmFileInput: HTMLInputElement | null = $state(null);
	let snapshotDate = $state('');

	let showConfirm = $derived(
		form?.success === true && !form?.confirmed && (form?.total ?? 0) > 0
	);
	let confirmed = $derived(form?.success === true && form?.confirmed === true);

	// Same trick as app/imports: the confirm form re-sends the original File
	// through a mirrored hidden input, since nothing is staged server-side.
	$effect(() => {
		if (!confirmFileInput) return;
		if (!selectedFile) {
			confirmFileInput.value = '';
			return;
		}
		const dt = new DataTransfer();
		dt.items.add(selectedFile);
		confirmFileInput.files = dt.files;
	});

	function onFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		selectedFile = target.files?.[0] ?? null;
	}

	const numberFormat = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL'
	});
</script>

<svelte:head>
	<title>Importar investimentos</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 p-4">
	<div>
		<h1 class="text-xl font-semibold text-gray-900">
			Importar investimentos (B3)
		</h1>
		<p class="mt-1 text-sm text-gray-600">
			Envie os arquivos xlsx exportados da
			<a
				class="text-blue-600 underline"
				href="https://www.investidor.b3.com.br"
				target="_blank"
				rel="noreferrer">Área do Investidor da B3</a
			>: posição, movimentação ou negociação. O tipo é detectado automaticamente
			e reenvios são ignorados sem duplicar nada.
		</p>
	</div>

	<form
		method="POST"
		action="?/preview"
		enctype="multipart/form-data"
		use:enhance={() => {
			isSubmitting = true;
			return async ({ update }) => {
				isSubmitting = false;
				await update({ reset: false });
			};
		}}
		class="space-y-4 rounded-lg border border-gray-200 bg-white p-4"
	>
		<div>
			<label for="file" class="block text-sm font-medium text-gray-700"
				>Arquivo xlsx da B3</label
			>
			<input
				id="file"
				name="file"
				type="file"
				accept=".xlsx"
				required
				onchange={onFileChange}
				class="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm"
			/>
		</div>
		<div>
			<label
				for="snapshot_date"
				class="block text-sm font-medium text-gray-700"
			>
				Data da posição (apenas para arquivo de posição)
			</label>
			<input
				id="snapshot_date"
				name="snapshot_date"
				type="date"
				bind:value={snapshotDate}
				class="mt-1 block rounded border border-gray-300 px-2 py-1 text-sm"
			/>
			<p class="mt-1 text-xs text-gray-500">
				Se vazio, a data é lida do nome do arquivo (posicao-AAAA-MM-DD-...).
			</p>
		</div>
		<button
			type="submit"
			disabled={isSubmitting}
			class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
		>
			{isSubmitting ? 'Analisando…' : 'Analisar arquivo'}
		</button>
	</form>

	{#if form && form.success === false}
		<div
			class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
		>
			{form.message}
		</div>
	{/if}

	{#if showConfirm && form?.success}
		<div class="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
			<div class="flex items-baseline justify-between">
				<h2 class="text-sm font-semibold text-gray-900">{form.kind_label}</h2>
				<span class="text-xs text-gray-500">{form.filename}</span>
			</div>
			<p class="text-sm text-gray-600">
				{form.total} linhas reconhecidas{#if form.kind === 'posicao' && form.snapshot_date}
					· snapshot em {form.snapshot_date}{/if}
			</p>

			{#if (form.warnings ?? []).length > 0}
				<ul class="list-inside list-disc text-xs text-amber-700">
					{#each form.warnings ?? [] as warning (warning)}
						<li>{warning}</li>
					{/each}
				</ul>
			{/if}

			{#if (form.guessed_assets ?? []).length > 0}
				<div
					class="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
				>
					Ativos novos com classe inferida (um import de posição corrige
					automaticamente):
					{(form.guessed_assets ?? [])
						.map((asset) => `${asset.product_key} (${asset.asset_class})`)
						.join(', ')}
				</div>
			{/if}

			{#if form.kind === 'posicao'}
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b text-xs text-gray-500">
							<th class="py-1">Produto</th>
							<th class="py-1 text-right">Qtd.</th>
							<th class="py-1 text-right">Valor</th>
						</tr>
					</thead>
					<tbody>
						{#each form.preview_positions as row (row.product)}
							<tr class="border-b border-gray-100">
								<td class="py-1 pr-2">{row.product}</td>
								<td class="py-1 text-right">{row.quantity}</td>
								<td class="py-1 text-right"
									>{numberFormat.format(row.net_value)}</td
								>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<table class="w-full text-left text-sm">
					<thead>
						<tr class="border-b text-xs text-gray-500">
							<th class="py-1">Data</th>
							<th class="py-1">Tipo</th>
							<th class="py-1">Produto</th>
							<th class="py-1 text-right">Valor</th>
						</tr>
					</thead>
					<tbody>
						{#each form.preview_events as row, index (index)}
							<tr class="border-b border-gray-100">
								<td class="py-1 pr-2 whitespace-nowrap">{row.date}</td>
								<td class="py-1 pr-2">{row.type}</td>
								<td class="py-1 pr-2">{row.product}</td>
								<td class="py-1 text-right">
									{row.total_value === null
										? '—'
										: numberFormat.format(row.total_value)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			<form
				method="POST"
				action="?/confirm"
				enctype="multipart/form-data"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						isSubmitting = false;
						await update({ reset: false });
					};
				}}
			>
				<input
					bind:this={confirmFileInput}
					name="file"
					type="file"
					required
					class="hidden"
					tabindex="-1"
				/>
				<input
					type="hidden"
					name="snapshot_date"
					value={form.snapshot_date ?? snapshotDate}
				/>
				<button
					type="submit"
					disabled={isSubmitting}
					class="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
				>
					{isSubmitting
						? 'Importando…'
						: `Confirmar importação (${form.total} linhas)`}
				</button>
			</form>
		</div>
	{/if}

	{#if confirmed && form?.success}
		<div
			class="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900"
		>
			<p>
				<strong>{form.kind_label}</strong> importado: {form.inserted} novas linhas,
				{form.skipped_duplicates} já existiam{#if (form.assets_created ?? 0) > 0},
					{form.assets_created}
					ativos criados{/if}.
			</p>
			{#if (form.reconciliation ?? []).length > 0}
				<div
					class="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900"
				>
					<p class="font-medium">
						Divergências entre a posição calculada e a oficial (faltam
						movimentações?):
					</p>
					<ul class="mt-1 list-inside list-disc text-xs">
						{#each form.reconciliation ?? [] as diff (diff.assetId)}
							<li>
								calculado {diff.derivedQuantity} × oficial {diff.officialQuantity}
								(Δ {diff.delta})
							</li>
						{/each}
					</ul>
					<p class="mt-1 text-xs">
						O snapshot oficial vira a nova base — as divergências são
						informativas.
					</p>
				</div>
			{/if}
			<a
				class="text-sm text-blue-700 underline"
				href={resolve('/app/investments')}
			>
				Ver patrimônio →
			</a>
		</div>
	{/if}
</div>
