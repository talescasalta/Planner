<script lang="ts">
	import { page } from '$app/stores';
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
	<div class="w-full max-w-sm text-center space-y-4">
		<h1 class="text-2xl font-semibold text-red-600">Erro na autenticação</h1>
		<p class="text-gray-600">
			{$page.url.searchParams.get('message') || 'Não foi possível confirmar seu email. O link pode ter expirado ou ser inválido.'}
		</p>
		<a href="/login" class="inline-block text-indigo-600 hover:text-indigo-800 font-medium">
			Voltar para o login
		</a>
	</div>
</div>
