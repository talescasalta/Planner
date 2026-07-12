<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';

	let { children } = $props();
</script>

<div class="min-h-screen bg-gray-50">
	<header class="bg-white shadow">
		<div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
			<h1 class="text-lg font-semibold text-gray-900">Finanças</h1>
			<nav class="flex items-center gap-4">
				<a
					href={resolve('/app')}
					class="text-sm text-gray-600 hover:text-gray-900">Dashboard</a
				>
				<a
					href={resolve('/app/groups')}
					class="text-sm text-gray-600 hover:text-gray-900">Grupos</a
				>
				<a
					href={resolve('/app/transactions')}
					class="text-sm text-gray-600 hover:text-gray-900">Transações</a
				>
				<a
					href={resolve('/app/installments')}
					class="text-sm text-gray-600 hover:text-gray-900">Parcelas</a
				>
				<a
					href={resolve('/app/categories')}
					class="text-sm text-gray-600 hover:text-gray-900">Categorias</a
				>
				<a
					href={resolve('/app/imports')}
					class="text-sm text-gray-600 hover:text-gray-900">Importar fatura</a
				>
				<a
					href={resolve('/app/review')}
					class="text-sm text-gray-600 hover:text-gray-900">Revisão</a
				>
				<a
					href={resolve('/app/rules')}
					class="text-sm text-gray-600 hover:text-gray-900">Regras</a
				>
				<a
					href={resolve('/app/settings')}
					class="text-sm text-gray-600 hover:text-gray-900">Configurações</a
				>
				<form method="POST" action="/logout" use:enhance class="inline">
					<button type="submit" class="text-sm text-red-600 hover:text-red-800"
						>Sair</button
					>
				</form>
			</nav>
		</div>
	</header>

	<main class="max-w-7xl mx-auto px-4 py-6">
		{@render children()}
	</main>
</div>
