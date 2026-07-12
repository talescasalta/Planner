<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let preview = $derived(form?.preview ?? []);
	let total = $derived(form?.total ?? 0);
	let duplicates = $derived(form?.duplicates ?? 0);
	let filename = $derived(form?.filename ?? '');
	let mappingSource = $derived(form?.mapping_source ?? 'deterministic');
	let mappingConfidence = $derived(form?.mapping_confidence ?? 1);
	let mappingNotes = $derived(form?.mapping_notes ?? '');
	let showConfirm = $derived(form?.success === true && total > 0);

	const now = new Date();
	const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

	let selectedFile: File | null = $state(null);
	let pastedText = $state('');
	let isDragging = $state(false);
	let isConfirming = $state(false);
	let confirmFileInput: HTMLInputElement | null = $state(null);

	type SourceType =
		'credit_card' | 'bank_account' | 'vale_alimentacao' | 'vale_refeicao';
	let sourceType: SourceType = $state('credit_card');

	const sourceOptions: Array<{
		value: SourceType;
		label: string;
		hint: string;
	}> = [
		{
			value: 'credit_card',
			label: 'Cartão de crédito',
			hint: 'Gastos aparecem como valores positivos (Nubank, Itaú, etc.)'
		},
		{
			value: 'bank_account',
			label: 'Conta corrente',
			hint: 'Despesas já aparecem como valores negativos.'
		},
		{
			value: 'vale_alimentacao',
			label: 'Vale alimentação',
			hint: 'Benefício de mercado (Alelo, VR, Sodexo, Caju, Flash...).'
		},
		{
			value: 'vale_refeicao',
			label: 'Vale refeição',
			hint: 'Benefício de refeição (Alelo, VR, Sodexo, Caju, Flash...).'
		}
	];

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

	function isAcceptedFile(file: File): boolean {
		return (
			file.name.toLowerCase().endsWith('.csv') || file.type.startsWith('image/')
		);
	}

	function setFile(file: File | null) {
		selectedFile = file;
		if (file) pastedText = '';
	}

	function syncVisibleInput(file: File) {
		// push into the visible input so the form submits with it
		const input = document.getElementById('file') as HTMLInputElement | null;
		if (input) {
			const dt = new DataTransfer();
			dt.items.add(file);
			input.files = dt.files;
		}
	}

	function onFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		setFile(target.files?.[0] ?? null);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file && isAcceptedFile(file)) {
			setFile(file);
			syncVisibleInput(file);
		}
	}

	function pastedImage(
		items: DataTransferItemList | DataTransferItem[]
	): File | null {
		for (const item of items) {
			if (!item.type.startsWith('image/')) continue;
			const blob = item.getAsFile();
			if (!blob) continue;
			const extension = item.type.split('/')[1] ?? 'png';
			return new File([blob], `print-colado.${extension}`, { type: item.type });
		}
		return null;
	}

	function onPaste(e: ClipboardEvent) {
		if (isConfirming) return;
		const items = e.clipboardData?.items ?? [];
		const image = pastedImage(items);
		if (image) {
			setFile(image);
			syncVisibleInput(image);
			e.preventDefault();
			return;
		}
		// Text paste: only capture when the user isn't pasting into a field
		// (the textarea below handles its own paste natively).
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea')) return;
		const text = e.clipboardData?.getData('text/plain');
		if (text?.trim()) {
			pastedText = text;
			clearFile();
			e.preventDefault();
		}
	}

	function clearFile() {
		selectedFile = null;
		const input = document.getElementById('file') as HTMLInputElement | null;
		if (input) input.value = '';
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

	function enhanceConfirm() {
		isConfirming = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			isConfirming = false;
		};
	}
</script>

<svelte:window onpaste={onPaste} />

<div class="max-w-3xl mx-auto space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold text-gray-900">Importar fatura</h2>
		<form method="POST" action="?/repair_access" use:enhance>
			<button
				type="submit"
				class="text-xs text-gray-500 hover:text-gray-900 underline"
			>
				Reparar permissões
			</button>
		</form>
	</div>

	{#if form?.success && form?.message && !form?.preview}
		<div
			class="bg-green-50 border border-green-200 text-green-800 text-sm rounded p-3"
		>
			{form.message}
		</div>
	{/if}

	<form
		method="POST"
		action="?/preview"
		use:enhance
		enctype="multipart/form-data"
		class="bg-white p-6 rounded-lg shadow space-y-4"
	>
		<div>
			<label
				for="reference_month"
				class="block text-sm font-medium text-gray-700">Mês de referência</label
			>
			<input
				id="reference_month"
				name="reference_month"
				type="month"
				value={currentMonth}
				required
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
			/>
			<p class="mt-1 text-xs text-gray-500">
				Mês ao qual esta fatura se refere. As transações serão agrupadas por
				este mês.
			</p>
		</div>

		<div>
			<span class="block text-sm font-medium text-gray-700">Tipo de origem</span
			>
			<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each sourceOptions as option (option.value)}
					<label
						class={`flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm ${sourceType === option.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
					>
						<input
							type="radio"
							name="source_type"
							value={option.value}
							checked={sourceType === option.value}
							onchange={() => (sourceType = option.value)}
							class="mt-0.5"
						/>
						<span>
							<span class="block font-medium text-gray-900">{option.label}</span
							>
							<span class="block text-xs text-gray-500">{option.hint}</span>
						</span>
					</label>
				{/each}
			</div>
		</div>

		<div>
			<span class="block text-sm font-medium text-gray-700 mb-1"
				>Arquivo da fatura (CSV ou print)</span
			>
			<label
				for="file"
				ondragover={onDragOver}
				ondragleave={onDragLeave}
				ondrop={onDrop}
				class="flex flex-col items-center justify-center gap-2 w-full px-4 py-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors {isDragging
					? 'border-indigo-500 bg-indigo-50'
					: 'border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-gray-400'}"
			>
				{#if selectedFile}
					<svg
						class="w-8 h-8 text-indigo-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
						/>
					</svg>
					<span class="text-sm font-medium text-gray-900"
						>{selectedFile.name}</span
					>
					<span class="text-xs text-gray-500"
						>{formatBytes(selectedFile.size)} — clique ou solte outro arquivo para
						trocar</span
					>
				{:else}
					<svg
						class="w-10 h-10 text-gray-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
						/>
					</svg>
					<span class="text-sm font-medium text-gray-700"
						>Clique para selecionar, arraste ou cole (Ctrl+V) aqui</span
					>
					<span class="text-xs text-gray-500"
						>Formatos aceitos: .csv, .png, .jpg, .webp — prints de fatura
						funcionam</span
					>
				{/if}
			</label>
			<input
				id="file"
				name="file"
				type="file"
				accept=".csv,image/png,image/jpeg,image/webp,image/gif"
				required={!pastedText.trim()}
				class="sr-only"
				onchange={onFileChange}
			/>
		</div>

		<div>
			<label
				for="pasted_text"
				class="block text-sm font-medium text-gray-700 mb-1"
				>Ou cole o texto da fatura</label
			>
			<textarea
				id="pasted_text"
				name="pasted_text"
				rows="4"
				bind:value={pastedText}
				oninput={() => {
					if (pastedText.trim()) clearFile();
				}}
				placeholder="Cole aqui as linhas copiadas do app ou site do banco / benefício (Ctrl+V em qualquer lugar da página também funciona)"
				class="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
			></textarea>
			<p class="mt-1 text-xs text-gray-500">
				Se um arquivo estiver selecionado, ele tem prioridade sobre o texto
				colado.
			</p>
		</div>

		<button
			type="submit"
			class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
			>Visualizar</button
		>
		{#if form && !form.success}
			<p class="text-sm text-red-600">{form.message}</p>
		{/if}
	</form>

	{#if showConfirm}
		<div class="bg-white p-6 rounded-lg shadow space-y-4">
			<div class="flex items-center justify-between">
				<h3 class="text-lg font-medium text-gray-900">Preview: {filename}</h3>
				<span class="text-sm text-gray-600"
					>{total} linhas ({duplicates} duplicatas detectadas)</span
				>
			</div>
			{#if mappingSource !== 'deterministic'}
				<div
					class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
				>
					{mappingSource === 'vision'
						? 'As transações foram extraídas da imagem com IA. Confira os valores antes de confirmar.'
						: 'O conteúdo da fatura foi interpretado com IA antes do preview.'}
					Confiança: {(mappingConfidence * 100).toFixed(0)}%.
					{#if mappingNotes}
						<span class="block text-amber-800">{mappingNotes}</span>
					{/if}
				</div>
			{/if}

			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-gray-50">
						<tr>
							<th
								class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
								>Data</th
							>
							<th
								class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
								>Descrição</th
							>
							<th
								class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase"
								>Valor</th
							>
							<th
								class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
								>Duplicata</th
							>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-200">
						{#each preview as row (row)}
							<tr class={row.duplicate ? 'bg-red-50' : ''}>
								<td class="px-4 py-2 text-sm text-gray-900">{row.date}</td>
								<td class="px-4 py-2 text-sm text-gray-900">
									<span class="block font-medium">{row.clean_description}</span>
									{#if row.clean_description !== row.description.toUpperCase()}
										<span class="block max-w-xl truncate text-xs text-gray-500"
											>{row.description}</span
										>
									{/if}
								</td>
								<td class="px-4 py-2 text-sm text-gray-900 text-right"
									>{row.amount.toFixed(2)}</td
								>
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
				use:enhance={enhanceConfirm}
				enctype="multipart/form-data"
				class="pt-4"
				aria-busy={isConfirming}
			>
				<input
					type="hidden"
					name="reference_month"
					value={form?.reference_month ?? currentMonth}
				/>
				<input
					type="hidden"
					name="source_type"
					value={form?.source_type ?? sourceType}
				/>
				<input type="hidden" name="pasted_text" value={pastedText} />
				<input
					bind:this={confirmFileInput}
					name="file"
					type="file"
					accept=".csv,image/png,image/jpeg,image/webp,image/gif"
					class="sr-only"
					tabindex="-1"
					aria-hidden="true"
				/>
				{#if !selectedFile && !pastedText.trim()}
					<p
						class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3 mb-3"
					>
						Recarregamos a página? Volte para a etapa anterior e selecione o
						arquivo ou cole o conteúdo novamente.
					</p>
				{/if}
				{#if isConfirming}
					<p
						class="mb-3 rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-800"
					>
						Importando e classificando transações. Isso pode levar alguns
						instantes.
					</p>
				{/if}
				<div class="flex items-center justify-between gap-3">
					<a
						href={resolve('/app/imports')}
						class={`text-sm ${isConfirming ? 'pointer-events-none text-gray-300' : 'text-gray-600 hover:text-gray-900'}`}
						aria-disabled={isConfirming}
					>
						Cancelar
					</a>
					<button
						type="submit"
						disabled={(!selectedFile && !pastedText.trim()) || isConfirming}
						class="inline-flex min-w-44 items-center justify-center gap-2 rounded-md border border-transparent bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
					>
						{#if isConfirming}
							<span
								class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
								aria-hidden="true"
							></span>
							Processando...
						{:else}
							Confirmar importação
						{/if}
					</button>
				</div>
			</form>
		</div>
	{/if}
</div>
