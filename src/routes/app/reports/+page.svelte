<script lang="ts">
	let { data } = $props();
	let totalsByProfile = $derived(data.totalsByProfile ?? []);
	let totalsByCategory = $derived(data.totalsByCategory ?? []);
	let totalsByPayer = $derived(data.totalsByPayer ?? []);
	let filters = $derived(data.filters ?? {});
	let profiles = $derived(data.profiles ?? []);
	let categories = $derived(data.categories ?? []);
</script>

<div class="max-w-4xl mx-auto space-y-6">
	<h2 class="text-xl font-semibold text-gray-900">Relatórios</h2>

	<form method="GET" class="bg-white p-4 rounded-lg shadow grid grid-cols-1 md:grid-cols-4 gap-4">
		<div>
			<label for="month" class="block text-xs font-medium text-gray-700">Mês</label>
			<input id="month" name="month" type="month" value={filters.month} class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1" />
		</div>
		<div>
			<label for="profile" class="block text-xs font-medium text-gray-700">Perfil</label>
			<select id="profile" name="profile" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1">
				<option value="">Todos</option>
				{#each profiles as p}
					<option value={p.id} selected={p.id === filters.profileId}>{p.name}</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="category" class="block text-xs font-medium text-gray-700">Categoria</label>
			<select id="category" name="category" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1">
				<option value="">Todas</option>
				{#each categories as c}
					<option value={c.id} selected={c.id === filters.categoryId}>{c.name}</option>
				{/each}
			</select>
		</div>
		<div>
			<label for="review_status" class="block text-xs font-medium text-gray-700">Status</label>
			<select id="review_status" name="review_status" class="mt-1 block w-full rounded-md border-gray-300 shadow-sm text-sm px-2 py-1">
				<option value="">Todos</option>
				<option value="needs_review" selected={filters.reviewStatus === 'needs_review'}>Revisar</option>
				<option value="confirmed" selected={filters.reviewStatus === 'confirmed'}>Confirmado</option>
				<option value="ignored" selected={filters.reviewStatus === 'ignored'}>Ignorado</option>
			</select>
		</div>
		<div class="md:col-span-4 flex justify-end">
			<button type="submit" class="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700">Filtrar</button>
		</div>
	</form>

	<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
		<div class="bg-white p-4 rounded-lg shadow">
			<h3 class="text-sm font-semibold text-gray-900 mb-3">Por Perfil</h3>
			<table class="min-w-full text-sm">
				<tbody>
					{#each totalsByProfile as row}
						<tr class="border-b">
							<td class="py-2">{row.name}</td>
							<td class="py-2 text-right font-medium">{row.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="bg-white p-4 rounded-lg shadow">
			<h3 class="text-sm font-semibold text-gray-900 mb-3">Por Categoria</h3>
			<table class="min-w-full text-sm">
				<tbody>
					{#each totalsByCategory as row}
						<tr class="border-b">
							<td class="py-2">{row.name}</td>
							<td class="py-2 text-right font-medium">{row.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="bg-white p-4 rounded-lg shadow">
			<h3 class="text-sm font-semibold text-gray-900 mb-3">Por Pagador</h3>
			<table class="min-w-full text-sm">
				<tbody>
					{#each totalsByPayer as row}
						<tr class="border-b">
							<td class="py-2">{row.name}</td>
							<td class="py-2 text-right font-medium">{row.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
