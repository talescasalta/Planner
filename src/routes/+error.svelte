<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
	<div class="text-center space-y-4">
		<h1 class="text-2xl font-semibold text-gray-900">Erro {$page.status}</h1>
		<p class="text-gray-600">{$page.error?.message ?? 'Algo deu errado.'}</p>
		<a
			href={resolve('/app')}
			class="text-indigo-600 hover:text-indigo-800 text-sm"
			>Voltar ao dashboard</a
		>
	</div>
</div>
