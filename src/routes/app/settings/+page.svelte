<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let user = $derived(data.user);
	let profile = $derived(data.profile);
	let ownNames = $derived((data.ownNames ?? []).join('\n'));
	let saving = $state(false);
	const NAMES_PLACEHOLDER = 'Maria Souza\nMaria S';
</script>

<div class="max-w-2xl mx-auto space-y-6">
	<h2 class="text-xl font-semibold text-gray-900">Configurações</h2>

	<div class="bg-white p-6 rounded-lg shadow space-y-4">
		<h3 class="text-sm font-semibold text-gray-900">Perfil</h3>
		<div>
			<p class="text-sm text-gray-600">Email</p>
			<p class="text-sm font-medium text-gray-900">{user?.email ?? '-'}</p>
		</div>
		<div>
			<p class="text-sm text-gray-600">Nome de exibição</p>
			<p class="text-sm font-medium text-gray-900">
				{profile?.display_name ?? '-'}
			</p>
		</div>
	</div>

	<form
		method="POST"
		action="?/update_own_names"
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				await update({ reset: false });
				saving = false;
			};
		}}
		class="bg-white p-6 rounded-lg shadow space-y-3"
	>
		<h3 class="text-sm font-semibold text-gray-900">
			Nomes nas suas transferências
		</h3>
		<p class="text-sm text-gray-600">
			Como o nome da sua casa aparece nos extratos, um por linha. Ao importar,
			um Pix com um desses nomes e o mesmo valor, de sinal oposto, em outra
			conta sua é sugerido como transferência entre contas.
		</p>
		<div>
			<label for="own_names" class="block text-sm font-medium text-gray-700"
				>Nomes (um por linha)</label
			>
			<textarea
				id="own_names"
				name="own_names"
				rows="4"
				placeholder={NAMES_PLACEHOLDER}
				class="mt-1 block w-full rounded-md border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
				>{ownNames}</textarea
			>
			<p class="mt-1 text-xs text-gray-500">
				Inclua a forma abreviada que o banco usa: o Nubank mostra o nome
				completo e o Itaú corta ("Tales C"). Deixe vazio para não sugerir
				transferências.
			</p>
		</div>
		{#if form?.message}
			<p
				class={`text-sm ${form.success ? 'text-green-700' : 'text-red-700'}`}
				role="status"
			>
				{form.message}
			</p>
		{/if}
		<button
			type="submit"
			disabled={saving}
			class="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-indigo-300"
		>
			{saving ? 'Salvando...' : 'Salvar nomes'}
		</button>
	</form>

	<div class="bg-white p-6 rounded-lg shadow space-y-4">
		<h3 class="text-sm font-semibold text-gray-900">Grupos</h3>
		<p class="text-sm text-gray-600">
			Grupos permitem que múltiplos usuários compartilhem e visualizem as mesmas
			transações. Todos os membros de um grupo podem ver e editar as transações
			do grupo.
		</p>
		<div class="bg-gray-50 rounded-md p-4 space-y-2">
			<p class="text-xs font-medium text-gray-700">
				Como adicionar alguém ao seu grupo:
			</p>
			<ol class="text-xs text-gray-600 space-y-1 list-decimal list-inside">
				<li>
					A pessoa precisa criar uma conta no app (receber um convite por email
					ou se cadastrar).
				</li>
				<li>
					No painel do Supabase, vá em <strong
						>Table Editor → household_members</strong
					>.
				</li>
				<li>
					Adicione uma nova linha com o <code>household_id</code> do seu grupo e
					o <code>user_id</code> da pessoa.
				</li>
				<li>Agora ambos verão as mesmas transações, categorias e regras.</li>
			</ol>
		</div>
	</div>
</div>
