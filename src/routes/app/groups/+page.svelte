<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let groups = $derived(data.groups ?? []);
	let showCreateForm = $state(false);

	function formatCurrency(value: number, currency = 'BRL') {
		return value.toLocaleString('pt-BR', { style: 'currency', currency });
	}

	function formatMonth(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return month || 'Sem mês';
		return new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', {
			month: 'long',
			year: 'numeric'
		});
	}
</script>

<div class="max-w-5xl mx-auto space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-xl font-semibold text-gray-900">Grupos</h2>
		<button
			type="button"
			class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
			onclick={() => (showCreateForm = !showCreateForm)}
		>
			{showCreateForm ? 'Cancelar' : 'Criar grupo'}
		</button>
	</div>

	{#if form && !form.success}
		<p class="text-sm text-red-600">{form.message}</p>
	{/if}
	{#if form?.success}
		<p class="text-sm text-green-600">{form.message}</p>
	{/if}

	{#if showCreateForm}
		<form method="POST" action="?/create" use:enhance class="bg-white p-6 rounded-lg shadow space-y-4">
			<div>
				<label for="group_name" class="block text-sm font-medium text-gray-700">Nome do grupo</label>
				<input
					id="group_name"
					name="name"
					type="text"
					required
					placeholder="Ex: Minha Casa"
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
				/>
			</div>
			<button type="submit" class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700">Criar</button>
		</form>
	{/if}

	{#if groups.length === 0 && !showCreateForm}
		<div class="bg-white p-6 rounded-lg shadow text-center">
			<p class="text-gray-600">Você ainda não pertence a nenhum grupo.</p>
			<p class="text-sm text-gray-500 mt-1">Crie um grupo para começar a organizar suas finanças.</p>
		</div>
	{/if}

	{#each groups as group}
		<div class="bg-white p-6 rounded-lg shadow space-y-4">
			<div class="flex items-center justify-between">
				<div>
					<h3 class="text-lg font-medium text-gray-900">{group.name}</h3>
					<p class="text-xs text-gray-500">Seu papel: {group.role === 'admin' ? 'Administrador' : 'Membro'}</p>
				</div>
			</div>

			<div>
				<h4 class="text-sm font-semibold text-gray-700 mb-2">Membros ({group.members.length})</h4>
				<ul class="divide-y divide-gray-100">
					{#each group.members as member}
						<li class="py-2 flex items-center justify-between">
							<div>
								<span class="text-sm text-gray-900">{member.display_name}</span>
								<span class="text-xs text-gray-500 ml-2">({member.role})</span>
							</div>
							{#if member.user_id !== data.user?.id}
								<form method="POST" action="?/remove_member" use:enhance class="inline">
									<input type="hidden" name="group_id" value={group.id} />
									<input type="hidden" name="user_id" value={member.user_id} />
									<button type="submit" class="text-xs text-red-600 hover:text-red-800">Remover</button>
								</form>
							{:else}
								<span class="text-xs text-gray-400">Você</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>

			<div class="border-t pt-4">
				<h4 class="text-sm font-semibold text-gray-700 mb-2">Adicionar membro</h4>
				<form method="POST" action="?/add_member" use:enhance class="flex gap-2">
					<input type="hidden" name="group_id" value={group.id} />
					<input
						name="email"
						type="email"
						required
						placeholder="email@exemplo.com"
						class="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
					/>
					<button type="submit" class="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Adicionar</button>
				</form>
			</div>

			<div class="border-t pt-4 space-y-4">
				<div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
					<div>
						<h4 class="text-sm font-semibold text-gray-700">Transações do grupo</h4>
						<p class="text-xs text-gray-500">Resumo das transações que você pode visualizar.</p>
					</div>
					<form method="GET" class="flex items-end gap-2">
						<label for="month-{group.id}" class="text-xs font-medium text-gray-600">
							Mês
							<select
								id="month-{group.id}"
								name="month_{group.id}"
								class="mt-1 block w-48 rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
								onchange={(event) => event.currentTarget.form?.requestSubmit()}
							>
								{#if group.activity.monthOptions.length === 0}
									<option value="">Sem transações</option>
								{/if}
								{#each group.activity.monthOptions as month}
									<option value={month} selected={month === group.activity.selectedMonth}>{formatMonth(month)}</option>
								{/each}
							</select>
						</label>
					</form>
				</div>

				<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
					<div class="rounded-md bg-gray-50 p-3">
						<p class="text-xs text-gray-500">Transações</p>
						<p class="text-sm font-semibold text-gray-900">{group.activity.summary.count}</p>
					</div>
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-xs text-red-700">Despesas</p>
						<p class="text-sm font-semibold text-red-800">{formatCurrency(group.activity.summary.expenses)}</p>
					</div>
					<div class="rounded-md bg-green-50 p-3">
						<p class="text-xs text-green-700">Créditos</p>
						<p class="text-sm font-semibold text-green-800">{formatCurrency(group.activity.summary.credits)}</p>
					</div>
					<div class="rounded-md bg-gray-50 p-3">
						<p class="text-xs text-gray-500">Saldo</p>
						<p class="text-sm font-semibold text-gray-900">{formatCurrency(group.activity.summary.balance)}</p>
					</div>
				</div>

				{#if group.activity.transactions.length === 0}
					<p class="text-sm text-gray-500">Nenhuma transação encontrada para este mês.</p>
				{:else}
					<div class="overflow-x-auto rounded-md border border-gray-100">
						<table class="min-w-full divide-y divide-gray-100 text-sm">
							<thead class="bg-gray-50">
								<tr>
									<th class="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Data</th>
									<th class="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Descrição</th>
									<th class="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Classificação</th>
									<th class="px-3 py-2 text-right text-xs font-medium uppercase text-gray-500">Valor</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-gray-100">
								{#each group.activity.transactions as transaction}
									<tr>
										<td class="whitespace-nowrap px-3 py-2 text-gray-700">{transaction.date}</td>
										<td class="px-3 py-2 text-gray-900">
											<a href="/app/transactions/{transaction.id}" class="hover:text-indigo-700">{transaction.description}</a>
										</td>
										<td class="px-3 py-2 text-gray-600">
											{transaction.category?.name ?? 'Sem categoria'}
											{#if transaction.subcategory?.name}
												<span class="text-gray-400">/</span> {transaction.subcategory.name}
											{/if}
										</td>
										<td class={`whitespace-nowrap px-3 py-2 text-right font-medium ${transaction.amount < 0 ? 'text-red-700' : 'text-green-700'}`}>
											{formatCurrency(transaction.amount, transaction.currency ?? 'BRL')}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>
		</div>
	{/each}
</div>
