<script lang="ts">
	let { data } = $props();
	let user = $derived(data.user);
	let profile = $derived(data.profile);
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
			<p class="text-sm font-medium text-gray-900">{profile?.display_name ?? '-'}</p>
		</div>
	</div>

	<div class="bg-white p-6 rounded-lg shadow space-y-4">
		<h3 class="text-sm font-semibold text-gray-900">Grupos</h3>
		<p class="text-sm text-gray-600">
			Grupos permitem que múltiplos usuários compartilhem e visualizem as mesmas transações.
			Todos os membros de um grupo podem ver e editar as transações do grupo.
		</p>
		<div class="bg-gray-50 rounded-md p-4 space-y-2">
			<p class="text-xs font-medium text-gray-700">Como adicionar alguém ao seu grupo:</p>
			<ol class="text-xs text-gray-600 space-y-1 list-decimal list-inside">
				<li>A pessoa precisa criar uma conta no app (receber um convite por email ou se cadastrar).</li>
				<li>No painel do Supabase, vá em <strong>Table Editor → household_members</strong>.</li>
				<li>Adicione uma nova linha com o <code>household_id</code> do seu grupo e o <code>user_id</code> da pessoa.</li>
				<li>Agora ambos verão as mesmas transações, categorias e regras.</li>
			</ol>
		</div>
	</div>
</div>
