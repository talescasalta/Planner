<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let accounts = $derived(data.accounts ?? []);
	let coverage = $derived(data.coverage ?? { months: [], rows: [] });
	let preview = $derived(form?.preview ?? []);
	let total = $derived(form?.total ?? 0);
	let duplicates = $derived(form?.duplicates ?? 0);
	let possibleDuplicates = $derived(form?.possible_duplicates ?? []);
	let filename = $derived(form?.filename ?? '');
	let mappingSource = $derived(form?.mapping_source ?? 'deterministic');
	let mappingConfidence = $derived(form?.mapping_confidence ?? 1);
	let mappingNotes = $derived(form?.mapping_notes ?? '');
	let showConfirm = $derived(form?.success === true && total > 0);

	// Below sm the confirmation bar pins above the bottom navigation.
	const CONFIRM_BAR =
		'fixed inset-x-0 bottom-16 z-20 flex items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 shadow-lg sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none';

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
	let accountName = $state('');

	// The account is remembered per source type so the usual one is already
	// filled in; storage can be missing or blocked, so every access is guarded.
	const ACCOUNT_STORAGE_PREFIX = 'planner.import.account.';

	function rememberedAccount(type: SourceType): string {
		try {
			return localStorage.getItem(ACCOUNT_STORAGE_PREFIX + type) ?? '';
		} catch {
			return '';
		}
	}

	function rememberAccount(type: SourceType, name: string) {
		try {
			if (name.trim())
				localStorage.setItem(ACCOUNT_STORAGE_PREFIX + type, name);
		} catch {
			// Remembering the account is a convenience only.
		}
	}

	function suggestedAccount(type: SourceType): string {
		const known = accounts.filter((account) => account.source_type === type);
		return rememberedAccount(type) || (known.length === 1 ? known[0].name : '');
	}

	function chooseSourceType(type: SourceType) {
		sourceType = type;
		accountName = suggestedAccount(type);
	}

	onMount(() => {
		if (!accountName) accountName = suggestedAccount(sourceType);
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
		const [year, monthNumber] = month.split('-');
		return `${MONTH_NAMES[Number(monthNumber) - 1]}/${year.slice(2)}`;
	}

	function coverageCellClass(state: string): string {
		if (state === 'ok') return 'bg-emerald-50 text-emerald-800';
		if (state === 'gap') return 'bg-rose-100 font-semibold text-rose-800';
		return 'text-gray-300';
	}

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
		const name = file.name.toLowerCase();
		return (
			name.endsWith('.csv') ||
			name.endsWith('.pdf') ||
			file.type === 'application/pdf' ||
			file.type.startsWith('image/')
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

	{#if coverage.rows.length > 0}
		<section
			class="rounded-lg bg-white p-4 shadow"
			aria-labelledby="coverage-title"
		>
			<h3 id="coverage-title" class="text-sm font-semibold text-gray-900">
				Cobertura dos extratos
			</h3>
			<p class="mt-1 text-xs text-gray-500">
				Lançamentos por conta e mês. Um mês em vermelho ("0") não tem
				lançamentos entre meses que têm: pode ser um extrato não importado.
			</p>
			<div class="mt-3 overflow-x-auto">
				<table class="min-w-full text-center text-xs">
					<thead>
						<tr>
							<th
								scope="col"
								class="sticky left-0 bg-white py-1 pr-3 text-left font-medium text-gray-500"
								>Conta</th
							>
							{#each coverage.months as month (month)}
								<th
									scope="col"
									class="whitespace-nowrap px-1.5 py-1 font-medium text-gray-500"
									>{monthLabel(month)}</th
								>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each coverage.rows as row (row.account)}
							<tr>
								<th
									scope="row"
									class="sticky left-0 whitespace-nowrap bg-white py-1 pr-3 text-left font-medium text-gray-900"
									>{row.account}</th
								>
								{#each row.cells as cell (cell.month)}
									<td class="p-0.5">
										<span
											class={`block rounded px-1.5 py-1 ${coverageCellClass(cell.state)}`}
											title={cell.state === 'gap'
												? `${row.account}: sem lançamentos em ${monthLabel(cell.month)}`
												: undefined}
											>{cell.state === 'none' ? '—' : cell.count}</span
										>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<form
		method="POST"
		action="?/preview"
		use:enhance
		onsubmit={() => rememberAccount(sourceType, accountName)}
		enctype="multipart/form-data"
		class="bg-white p-6 rounded-lg shadow space-y-4"
	>
		<div>
			<label
				for="reference_month"
				class="block text-sm font-medium text-gray-700"
				>{sourceType === 'credit_card'
					? 'Mês de fechamento da fatura'
					: 'Mês de referência'}</label
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
				{#if sourceType === 'credit_card'}
					Mês em que a fatura <strong>fechou</strong>, não o do vencimento: a
					fatura que fecha em 26/08 e vence em 03/09 é agosto.
				{:else}
					Cada lançamento é agrupado pelo mês da própria data. Este campo só
					vale para linhas cuja data não puder ser lida.
				{/if}
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
							onchange={() => chooseSourceType(option.value)}
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
			<label for="account_name" class="block text-sm font-medium text-gray-700"
				>Conta</label
			>
			<input
				id="account_name"
				name="account_name"
				list="account-options"
				bind:value={accountName}
				required
				maxlength="60"
				autocomplete="off"
				placeholder="Ex.: Itaú conta, Nubank cartão"
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
			/>
			<datalist id="account-options">
				{#each accounts as account (account.name)}
					<option value={account.name}></option>
				{/each}
			</datalist>
			<p class="mt-1 text-xs text-gray-500">
				Use sempre o mesmo nome para a mesma conta: é ele que alimenta a
				cobertura dos extratos acima.
			</p>
		</div>

		<div>
			<span class="block text-sm font-medium text-gray-700 mb-1"
				>Arquivo da fatura (CSV, PDF ou print)</span
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
						>Formatos aceitos: .csv, .pdf, .png, .jpg, .webp — extratos em PDF e
						prints de fatura funcionam</span
					>
				{/if}
			</label>
			<input
				id="file"
				name="file"
				type="file"
				accept=".csv,.pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif"
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

			{#if form?.source_type === 'credit_card'}
				<p class="text-sm text-gray-700">
					Será lançada em <strong>{form?.reference_month}</strong>, o mês em que
					a fatura fechou
					{#if form?.reference_month_inferred}
						<span class="text-gray-500"
							>— deduzido da compra mais recente do arquivo</span
						>
					{/if}
				</p>
			{:else}
				<p class="text-sm text-gray-700">
					Cada lançamento entra no mês da própria data.
				</p>
			{/if}
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

			{#if possibleDuplicates.length > 0}
				<div
					class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
				>
					<p class="font-medium">
						{possibleDuplicates.length}
						{possibleDuplicates.length === 1
							? 'lançamento parece já existir'
							: 'lançamentos parecem já existir'} por outra fonte
					</p>
					<p class="mt-1 text-amber-800">
						Mesmo valor, conta e data (até um dia de diferença), com texto
						diferente. Serão importados como <strong>ignorados</strong>: não
						contam nos totais e você pode reativá-los em Transações.
					</p>
					<ul class="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
						{#each possibleDuplicates as item (`${item.date}|${item.description}|${item.amount}`)}
							<li>
								{item.date} · {item.description}
								<span class="text-amber-700"
									>(já existe: {item.existing_description}, {item.existing_date})</span
								>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="hidden overflow-x-auto sm:block">
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
									{@render previewDescription(row)}
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

			<ul class="divide-y divide-gray-100 sm:hidden">
				{#each preview as row (row)}
					<li class="space-y-1 py-3 {row.duplicate ? 'bg-red-50' : ''}">
						<div class="flex items-start justify-between gap-3 text-sm">
							<span class="text-xs text-gray-500">{row.date}</span>
							<span class="font-medium text-gray-900"
								>{row.amount.toFixed(2)}</span
							>
						</div>
						<div class="text-sm text-gray-900">
							{@render previewDescription(row)}
						</div>
						{#if row.duplicate}
							<span
								class="inline-flex rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
								>Duplicata</span
							>
						{/if}
					</li>
				{/each}
			</ul>

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
					type="hidden"
					name="account_name"
					value={form?.account_name ?? accountName}
				/>
				<input
					type="hidden"
					name="preview_token"
					value={form?.preview_token ?? ''}
				/>
				<input
					bind:this={confirmFileInput}
					name="file"
					type="file"
					accept=".csv,.pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif"
					class="sr-only"
					tabindex="-1"
					aria-hidden="true"
				/>
				{#if !selectedFile && !pastedText.trim() && !form?.preview_token}
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
				<div class={CONFIRM_BAR}>
					<a
						href={resolve('/app/imports')}
						class={`text-sm ${isConfirming ? 'pointer-events-none text-gray-300' : 'text-gray-600 hover:text-gray-900'}`}
						aria-disabled={isConfirming}
					>
						Cancelar
					</a>
					<button
						type="submit"
						disabled={(!selectedFile &&
							!pastedText.trim() &&
							!form?.preview_token) ||
							isConfirming}
						class="inline-flex min-h-11 min-w-44 items-center justify-center gap-2 rounded-md border border-transparent bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300 sm:min-h-0"
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
				<div class="h-16 sm:hidden" aria-hidden="true"></div>
			</form>
		</div>
	{/if}
</div>

{#snippet previewDescription(row: (typeof preview)[number])}
	<span class="block font-medium">{row.clean_description}</span>
	{#if row.clean_description !== row.description.toUpperCase()}
		<span class="block max-w-xl truncate text-xs text-gray-500"
			>{row.description}</span
		>
	{/if}
{/snippet}
