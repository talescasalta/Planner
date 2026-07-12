<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		ArrowDown,
		ArrowUp,
		ArrowUpDown,
		Banknote,
		HandCoins,
		Plus,
		Search,
		Users,
		X
	} from 'lucide-svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let groups = $derived(data.groups ?? []);
	let showCreateForm = $state(false);
	let openAddMemberFor = $state<string | null>(null);
	let sortMode = $state<Record<string, 'paid_desc' | 'paid_asc' | 'name'>>({});
	let txSearch = $state<Record<string, string>>({});
	let txAmountSort = $state<Record<string, 'none' | 'desc' | 'asc'>>({});

	type GroupTransaction =
		PageData['groups'][number]['activity']['transactions'][number];

	function visibleTransactions(
		groupId: string,
		list: GroupTransaction[]
	): GroupTransaction[] {
		const term = (txSearch[groupId] ?? '').trim().toLowerCase();
		let arr = list;
		if (term) {
			arr = arr.filter((tx) => {
				const desc = tx.description?.toLowerCase() ?? '';
				const cat = tx.category_name?.toLowerCase() ?? '';
				const sub = tx.subcategory_name?.toLowerCase() ?? '';
				const payer = tx.paid_by_display_name?.toLowerCase() ?? '';
				return (
					desc.includes(term) ||
					cat.includes(term) ||
					sub.includes(term) ||
					payer.includes(term)
				);
			});
		}
		const sort = txAmountSort[groupId] ?? 'none';
		if (sort === 'desc')
			arr = [...arr].sort((a, b) => Number(b.amount) - Number(a.amount));
		else if (sort === 'asc')
			arr = [...arr].sort((a, b) => Number(a.amount) - Number(b.amount));
		return arr;
	}

	function cycleTxAmountSort(groupId: string) {
		const cur = txAmountSort[groupId] ?? 'none';
		const next = cur === 'none' ? 'desc' : cur === 'desc' ? 'asc' : 'none';
		txAmountSort = { ...txAmountSort, [groupId]: next };
	}

	function formatCurrency(value: number, currency = 'BRL') {
		return value.toLocaleString('pt-BR', { style: 'currency', currency });
	}

	function splitMethodLabel(method: string) {
		return method === 'equal' ? '50/50' : 'Por renda';
	}

	function formatMonth(month: string) {
		const [year, monthNumber] = month.split('-').map(Number);
		if (!year || !monthNumber) return month || 'Sem mês';
		return new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', {
			month: 'long',
			year: 'numeric'
		});
	}

	function sortedContributions(
		groupId: string,
		list: PageData['groups'][number]['activity']['contributions']
	) {
		const mode = sortMode[groupId] ?? 'paid_desc';
		const arr = [...list];
		if (mode === 'paid_desc')
			arr.sort((a, b) => b.expense_total - a.expense_total);
		else if (mode === 'paid_asc')
			arr.sort((a, b) => a.expense_total - b.expense_total);
		else
			arr.sort((a, b) => a.display_name.localeCompare(b.display_name, 'pt-BR'));
		return arr;
	}

	function cycleSort(groupId: string) {
		const current = sortMode[groupId] ?? 'paid_desc';
		const next =
			current === 'paid_desc'
				? 'paid_asc'
				: current === 'paid_asc'
					? 'name'
					: 'paid_desc';
		sortMode = { ...sortMode, [groupId]: next };
	}
</script>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<p class="text-sm font-medium uppercase tracking-wider text-gray-500">
				Grupos
			</p>
			<h2 class="mt-1 text-2xl font-semibold text-gray-950">
				Pessoas que dividem as finanças
			</h2>
		</div>
		<button
			type="button"
			class="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
			onclick={() => (showCreateForm = !showCreateForm)}
		>
			{#if showCreateForm}
				<X class="h-4 w-4" /> Cancelar
			{:else}
				<Plus class="h-4 w-4" /> Criar grupo
			{/if}
		</button>
	</div>

	{#if form?.success === false && form?.message}
		<p
			class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
		>
			{form.message}
		</p>
	{/if}
	{#if form?.success && form?.message}
		<p
			class="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
		>
			{form.message}
		</p>
	{/if}

	{#if showCreateForm}
		<form
			method="POST"
			action="?/create"
			use:enhance
			class="rounded-lg bg-white p-5 shadow"
		>
			<label for="group_name" class="block text-sm font-medium text-gray-700"
				>Nome do grupo</label
			>
			<div class="mt-2 flex gap-2">
				<input
					id="group_name"
					name="name"
					type="text"
					required
					placeholder="Ex: Minha Casa"
					class="flex-1 rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
				/>
				<button
					type="submit"
					class="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
					>Criar</button
				>
			</div>
		</form>
	{/if}

	{#if groups.length === 0 && !showCreateForm}
		<div class="rounded-lg bg-white p-8 text-center shadow">
			<Users class="mx-auto h-10 w-10 text-gray-300" />
			<p class="mt-3 text-sm text-gray-700">
				Você ainda não pertence a nenhum grupo.
			</p>
			<p class="text-xs text-gray-500">
				Crie um grupo para começar a organizar suas finanças compartilhadas.
			</p>
		</div>
	{/if}

	{#each groups as group (group.id)}
		{@const contributions = sortedContributions(
			group.id,
			group.activity.contributions
		)}
		{@const sortLabel =
			(sortMode[group.id] ?? 'paid_desc') === 'paid_desc'
				? 'Mais pagou'
				: (sortMode[group.id] ?? '') === 'paid_asc'
					? 'Menos pagou'
					: 'Nome'}
		<section class="space-y-4 rounded-lg bg-white p-5 shadow">
			<header class="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h3 class="text-lg font-semibold text-gray-950">{group.name}</h3>
					<p class="text-xs text-gray-500">
						Seu papel: <span class="font-medium text-gray-700"
							>{group.role === 'admin' ? 'Administrador' : 'Membro'}</span
						>
						· {group.members.length}
						{group.members.length === 1 ? 'membro' : 'membros'}
					</p>
				</div>

				{#if group.activity.monthOptions.length > 0}
					<form method="GET" class="flex items-center gap-2">
						<label
							for={`month-${group.id}`}
							class="text-xs font-medium uppercase tracking-wider text-gray-500"
							>Mês</label
						>
						<select
							id={`month-${group.id}`}
							name={`month_${group.id}`}
							class="rounded-md border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm"
							onchange={(event) => event.currentTarget.form?.requestSubmit()}
						>
							{#each group.activity.monthOptions as month (month)}
								<option
									value={month}
									selected={month === group.activity.selectedMonth}
									>{formatMonth(month)}</option
								>
							{/each}
						</select>
					</form>
				{/if}
			</header>

			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				<div class="rounded-md bg-gray-50 p-3">
					<p class="text-[11px] uppercase tracking-wide text-gray-500">
						Transações
					</p>
					<p class="mt-1 text-lg font-semibold text-gray-900">
						{group.activity.summary.count}
					</p>
				</div>
				<div class="rounded-md bg-rose-50 p-3">
					<p class="text-[11px] uppercase tracking-wide text-rose-700">
						Despesas
					</p>
					<p class="mt-1 text-lg font-semibold text-rose-800">
						{formatCurrency(group.activity.summary.expenses)}
					</p>
				</div>
				<div class="rounded-md bg-emerald-50 p-3">
					<p class="text-[11px] uppercase tracking-wide text-emerald-700">
						Receitas
					</p>
					<p class="mt-1 text-lg font-semibold text-emerald-800">
						{formatCurrency(group.activity.summary.credits)}
					</p>
				</div>
				<div class="rounded-md bg-gray-50 p-3">
					<p class="text-[11px] uppercase tracking-wide text-gray-500">Saldo</p>
					<p
						class={`mt-1 text-lg font-semibold ${group.activity.summary.balance >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}
					>
						{formatCurrency(group.activity.summary.balance)}
					</p>
				</div>
			</div>

			<div>
				<div class="flex items-center justify-between">
					<h4 class="text-sm font-semibold text-gray-800">Renda mensal</h4>
					<Banknote class="h-4 w-4 text-gray-400" />
				</div>

				<form
					method="POST"
					action="?/update_incomes"
					use:enhance
					class="mt-3 space-y-3 rounded-md border border-gray-100 bg-gray-50 p-3"
				>
					<input type="hidden" name="group_id" value={group.id} />
					<div class="grid gap-3 sm:grid-cols-2">
						{#each group.members as member (member.user_id)}
							<label class="block">
								<span class="block truncate text-xs font-medium text-gray-600"
									>{member.display_name}</span
								>
								<input type="hidden" name="user_id" value={member.user_id} />
								<input
									name="monthly_income"
									type="number"
									min="0"
									step="0.01"
									value={member.monthly_income ?? 0}
									class="mt-1 w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm"
								/>
							</label>
						{/each}
					</div>
					<div class="flex justify-end">
						<button
							type="submit"
							class="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
							>Salvar rendas</button
						>
					</div>
				</form>
			</div>

			<div>
				<div class="flex items-center justify-between">
					<h4 class="text-sm font-semibold text-gray-800">Divisão e acerto</h4>
					<button
						type="button"
						onclick={() => cycleSort(group.id)}
						class="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900"
						title="Trocar ordenação"
					>
						{#if (sortMode[group.id] ?? 'paid_desc') === 'paid_desc'}
							<ArrowDown class="h-3.5 w-3.5" />
						{:else if sortMode[group.id] === 'paid_asc'}
							<ArrowUp class="h-3.5 w-3.5" />
						{:else}
							<ArrowUpDown class="h-3.5 w-3.5" />
						{/if}
						{sortLabel}
					</button>
				</div>

				{#if contributions.length === 0 || group.activity.summary.expenses === 0}
					<p class="mt-3 text-xs text-gray-500">
						Nenhuma despesa compartilhada neste mês.
					</p>
				{:else}
					<ul class="mt-3 space-y-3">
						{#each contributions as c (c.user_id)}
							<li>
								<div class="flex items-center justify-between gap-3 text-sm">
									<div class="flex items-center gap-2 min-w-0">
										<span class="truncate font-medium text-gray-900"
											>{c.display_name}</span
										>
										{#if c.user_id === data.user?.id}
											<span
												class="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
												>Você</span
											>
										{/if}
										<span class="text-xs text-gray-400"
											>· {c.count} {c.count === 1 ? 'tx' : 'txs'}</span
										>
									</div>
									<div class="flex items-center gap-3 shrink-0">
										<span class="text-xs text-gray-500 tabular-nums"
											>{c.income_share.toFixed(0)}% da renda</span
										>
										<span
											class={`text-sm font-semibold tabular-nums ${c.net_total >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}
										>
											{c.net_total >= 0 ? 'Recebe ' : 'Paga '}{formatCurrency(
												Math.abs(c.net_total)
											)}
										</span>
									</div>
								</div>
								<div class="mt-1 grid grid-cols-3 gap-2 text-xs text-gray-500">
									<span
										>Pagou <strong class="font-semibold text-gray-700"
											>{formatCurrency(c.expense_total)}</strong
										></span
									>
									<span
										>Deveria <strong class="font-semibold text-gray-700"
											>{formatCurrency(c.owed_total)}</strong
										></span
									>
									<span
										>Renda <strong class="font-semibold text-gray-700"
											>{formatCurrency(c.monthly_income)}</strong
										></span
									>
								</div>
								<div class="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
									<div
										class="h-full rounded-full bg-indigo-500"
										style={`width: ${Math.max(c.share, c.expense_total > 0 ? 2 : 0)}%`}
									></div>
								</div>
							</li>
						{/each}
					</ul>

					<div
						class="mt-4 rounded-md border border-emerald-100 bg-emerald-50 p-3"
					>
						<div
							class="flex items-center gap-2 text-sm font-semibold text-emerald-900"
						>
							<HandCoins class="h-4 w-4" />
							Acerto necessário
						</div>
						{#if group.activity.settlementTransfers.length === 0}
							<p class="mt-2 text-sm text-emerald-800">
								Sem acerto pendente para este mês.
							</p>
						{:else}
							<ul class="mt-2 space-y-1.5 text-sm text-emerald-900">
								{#each group.activity.settlementTransfers as transfer (`${transfer.from_user_id}-${transfer.to_user_id}`)}
									<li>
										<span class="font-medium">{transfer.from_name}</span> paga
										<span class="font-semibold tabular-nums"
											>{formatCurrency(transfer.amount)}</span
										>
										para <span class="font-medium">{transfer.to_name}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</div>

			<div class="border-t border-gray-100 pt-3">
				<div class="flex items-center justify-between">
					<h4 class="text-sm font-semibold text-gray-800">Membros</h4>
					{#if group.role === 'admin'}
						<button
							type="button"
							onclick={() =>
								(openAddMemberFor =
									openAddMemberFor === group.id ? null : group.id)}
							class="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
						>
							{#if openAddMemberFor === group.id}
								<X class="h-3.5 w-3.5" /> Cancelar
							{:else}
								<Plus class="h-3.5 w-3.5" /> Adicionar membro
							{/if}
						</button>
					{/if}
				</div>

				{#if openAddMemberFor === group.id}
					<form
						method="POST"
						action="?/add_member"
						use:enhance
						class="mt-3 flex gap-2"
					>
						<input type="hidden" name="group_id" value={group.id} />
						<input
							name="email"
							type="email"
							required
							placeholder="email@exemplo.com"
							class="flex-1 rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
						/>
						<button
							type="submit"
							class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
							>Adicionar</button
						>
					</form>
				{/if}

				<ul class="mt-3 flex flex-wrap gap-2">
					{#each group.members as member (member.user_id)}
						<li
							class="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs"
						>
							<span class="font-medium text-gray-900"
								>{member.display_name}</span
							>
							<span class="text-gray-500"
								>· {member.role === 'admin' ? 'Admin' : 'Membro'}</span
							>
							{#if member.user_id === data.user?.id}
								<span
									class="rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-700"
									>Você</span
								>
							{:else if group.role === 'admin'}
								<form
									method="POST"
									action="?/remove_member"
									use:enhance
									class="inline"
								>
									<input type="hidden" name="group_id" value={group.id} />
									<input type="hidden" name="user_id" value={member.user_id} />
									<button
										type="submit"
										class="rounded-full p-0.5 text-gray-400 hover:bg-red-100 hover:text-red-700"
										title="Remover"
									>
										<X class="h-3 w-3" />
									</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			</div>

			{#if group.activity.summary.count > 0}
				{@const txs = visibleTransactions(
					group.id,
					group.activity.transactions
				)}
				{@const sort = txAmountSort[group.id] ?? 'none'}
				<div class="border-t border-gray-100 pt-3">
					<div class="flex flex-wrap items-end justify-between gap-3">
						<h4 class="text-sm font-semibold text-gray-800">
							Transações ({txs.length}{txs.length !==
							group.activity.transactions.length
								? ` de ${group.activity.transactions.length}`
								: ''})
						</h4>
						<div class="relative w-full sm:w-72">
							<Search
								class="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
							/>
							<input
								type="search"
								placeholder="Buscar descrição, categoria, pagador..."
								class="w-full rounded-md border-gray-300 pl-8 pr-8 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
								value={txSearch[group.id] ?? ''}
								oninput={(e) =>
									(txSearch = {
										...txSearch,
										[group.id]: (e.currentTarget as HTMLInputElement).value
									})}
							/>
							{#if txSearch[group.id]}
								<button
									type="button"
									onclick={() => (txSearch = { ...txSearch, [group.id]: '' })}
									class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
									aria-label="Limpar busca"
								>
									<X class="h-4 w-4" />
								</button>
							{/if}
						</div>
					</div>

					{#if txs.length === 0}
						<p class="mt-3 text-xs text-gray-500">
							Nenhuma transação corresponde à busca.
						</p>
					{:else}
						<div class="mt-3 overflow-x-auto rounded-md border border-gray-100">
							<table class="min-w-full divide-y divide-gray-100 text-sm">
								<thead class="bg-gray-50">
									<tr>
										<th
											class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500"
											>Data</th
										>
										<th
											class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500"
											>Descrição</th
										>
										<th
											class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500"
											>Pago por</th
										>
										<th
											class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500"
											>Classificação</th
										>
										<th
											class="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-gray-500"
											>Divisão</th
										>
										<th
											class="px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wider text-gray-500"
										>
											<button
												type="button"
												onclick={() => cycleTxAmountSort(group.id)}
												class={`inline-flex items-center gap-1 hover:text-gray-900 ${sort !== 'none' ? 'text-indigo-700' : ''}`}
												title={sort === 'none'
													? 'Ordenar por valor'
													: sort === 'desc'
														? 'Maior para menor'
														: 'Menor para maior'}
											>
												Valor
												{#if sort === 'desc'}
													<ArrowDown class="h-3.5 w-3.5" />
												{:else if sort === 'asc'}
													<ArrowUp class="h-3.5 w-3.5" />
												{:else}
													<ArrowUpDown class="h-3.5 w-3.5 text-gray-400" />
												{/if}
											</button>
										</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-gray-100">
									{#each txs as tx (tx.id)}
										<tr>
											<td class="whitespace-nowrap px-3 py-2 text-gray-700"
												>{tx.date}</td
											>
											<td class="px-3 py-2">
												<a
													href={resolve(`/app/transactions/${tx.id}`)}
													class="text-gray-900 hover:text-indigo-700"
													>{tx.description}</a
												>
											</td>
											<td class="whitespace-nowrap px-3 py-2 text-gray-700"
												>{tx.paid_by_display_name ?? 'Sem pagador'}</td
											>
											<td class="px-3 py-2 text-gray-600">
												{tx.category_name ?? 'Sem categoria'}
												{#if tx.subcategory_name}
													<span class="text-gray-400">/</span>
													{tx.subcategory_name}
												{/if}
											</td>
											<td class="whitespace-nowrap px-3 py-2 text-gray-700">
												{#if tx.amount < 0}
													<form
														method="POST"
														action="?/update_split_method"
														use:enhance
													>
														<input
															type="hidden"
															name="group_id"
															value={group.id}
														/>
														<input
															type="hidden"
															name="transaction_id"
															value={tx.id}
														/>
														<select
															name="split_method"
															class="rounded-md border-gray-300 py-1 pl-2 pr-7 text-xs shadow-sm"
															aria-label="Regra de divisão de {tx.description}"
															onchange={(event) =>
																event.currentTarget.form?.requestSubmit()}
														>
															<option
																value="income_proportional"
																selected={tx.split_method ===
																	'income_proportional'}
																>{splitMethodLabel(
																	'income_proportional'
																)}</option
															>
															<option
																value="equal"
																selected={tx.split_method === 'equal'}
																>{splitMethodLabel('equal')}</option
															>
														</select>
													</form>
												{:else}
													<span class="text-gray-400">-</span>
												{/if}
											</td>
											<td
												class={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${tx.amount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}
											>
												{formatCurrency(tx.amount, tx.currency ?? 'BRL')}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>
			{/if}
		</section>
	{/each}
</div>
