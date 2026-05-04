<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let groups = $derived(data.groups ?? []);
	let showCreateForm = $state(false);
</script>

<div class="max-w-3xl mx-auto space-y-6">
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
		</div>
	{/each}
</div>
