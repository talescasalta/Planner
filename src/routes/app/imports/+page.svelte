<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let preview = $derived(form?.preview ?? []);
	let total = $derived(form?.total ?? 0);
	let duplicates = $derived(form?.duplicates ?? 0);
	let filename = $derived(form?.filename ?? '');
	let showConfirm = $derived(form?.success === true && total > 0);

	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	let selectedFile: File | null = $state(null);
	let isDragging = $state(false);
	let confirmFileInput: HTMLInputElement | null = $state(null);

	// Mirror the selected file into the confirm form's hidden input as soon
	// as both are available, so the browser-native `required` check passes
	// without forcing the user to pick the file again.
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

	function setFile(file: File | null) {
		selectedFile = file;
	}

	function onFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		setFile(target.files?.[0] ?? null);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file && file.name.toLowerCase().endsWith('.csv')) {
			setFile(file);
			// also push into the visible input so the form submits with it
			const input = document.getElementById('file') as HTMLInputElement | null;
			if (input) {
				const dt = new DataTransfer();
				dt.items.add(file);
				input.files = dt.files;
			}
		}
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function onDragLeave() {
		isDragging = false;
	}

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
		return `${(n / 1024 / 1024).toFixed(1)} MB`;
	}
</script>

<div class="max-w-3xl mx-auto space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold text-gray-900">Importar fatura</h2>
		<form method="POST" action="?/repair_access" use:enhance>
			<button type="submit" class="text-xs text-gray-500 hover:text-gray-900 underline">
				Reparar permissões
			</button>
		</form>
	</div>

	{#if form?.success && form?.message && !form?.preview}
		<div class="bg-green-50 border border-green-200 text-green-800 text-sm rounded p-3">{form.message}</div>
	{/if}

	<form method="POST" action="?/preview" use:enhance enctype="multipart/form-data" class="bg-white p-6 rounded-lg shadow space-y-4">
		<div>
			<label for="reference_month" class="block text-sm font-medium text-gray-700">Mês de referência</label>
			<input
				id="reference_month"
				name="reference_month"
				type="month"
				value={currentMonth}
				required
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
			/>
			<p class="mt-1 text-xs text-gray-500">Mês ao qual esta fatura se refere. As transações serão agrupadas por este mês.</p>
		</div>

		<div>
			<span class="block text-sm font-medium text-gray-700 mb-1">Arquivo CSV da fatura</span>
			<label
				for="file"
				ondragover={onDragOver}
				ondragleave={onDragLeave}
				ondrop={onDrop}
				class="flex flex-col items-center justify-center gap-2 w-full px-4 py-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors {isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-400'}"
			>
				{#if selectedFile}
					<svg class="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<span class="text-sm font-medium text-gray-900">{selectedFile.name}</span>
					<span class="text-xs text-gray-500">{formatBytes(selectedFile.size)} — clique ou solte outro arquivo para trocar</span>
				{:else}
					<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
					</svg>
					<span class="text-sm font-medium text-gray-700">Clique para selecionar ou arraste o CSV aqui</span>
					<span class="text-xs text-gray-500">Formato aceito: .csv</span>
				{/if}
			</label>
			<input id="file" name="file" type="file" accept=".csv" required class="sr-only" onchange={onFileChange} />
		</div>

		<button type="submit" class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Visualizar</button>
		{#if form && !form.success}
			<p class="text-sm text-red-600">{form.message}</p>
		{/if}
	</form>

	{#if showConfirm}
		<div class="bg-white p-6 rounded-lg shadow space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="text-lg font-medium text-gray-900">Preview: {filename}</h3>
				<span class="text-sm text-gray-600">{total} linhas ({duplicates} duplicatas detectadas)</span>
			</div>

			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-gray-50">
						<tr>
							<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Data</th>
							<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Descrição</th>
							<th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Valor</th>
							<th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Duplicata</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200">
						{#each preview as row}
							<tr class={row.duplicate ? 'bg-red-50' : ''}>
								<td class="px-4 py-2 text-sm text-gray-900">{row.date}</td>
								<td class="px-4 py-2 text-sm text-gray-900">{row.description}</td>
								<td class="px-4 py-2 text-sm text-gray-900 text-right">{row.amount.toFixed(2)}</td>
								<td class="px-4 py-2 text-sm">
									{#if row.duplicate}
										<span class="text-red-600 font-medium">Sim</span>
									{:else}
										<span class="text-gray-400">Não</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<form
				method="POST"
				action="?/confirm"
				use:enhance
				enctype="multipart/form-data"
				class="pt-4"
			>
				<input type="hidden" name="reference_month" value={form?.reference_month ?? currentMonth} />
				<input
					bind:this={confirmFileInput}
					name="file"
					type="file"
					accept=".csv"
					class="sr-only"
					tabindex="-1"
					aria-hidden="true"
				/>
				{#if !selectedFile}
					<p class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-3">
						Recarregamos a página? Volte para a etapa anterior e selecione o arquivo novamente.
					</p>
				{/if}
				<div class="flex items-center justify-between">
					<a href="/app/imports" class="text-sm text-gray-600 hover:text-gray-900">Cancelar</a>
					<button
						type="submit"
						disabled={!selectedFile}
						class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
					>
						Confirmar importação
					</button>
				</div>
			</form>
		</div>
	{/if}
</div>
