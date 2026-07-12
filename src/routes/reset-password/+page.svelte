<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
	<div class="w-full max-w-sm space-y-6">
		<div class="space-y-2 text-center">
			<h1 class="text-2xl font-semibold text-gray-900">Criar nova senha</h1>
			<p class="text-sm text-gray-600">
				Escolha uma nova senha para sua conta.
			</p>
		</div>

		<form method="POST" use:enhance class="space-y-4">
			<div>
				<label for="password" class="block text-sm font-medium text-gray-700"
					>Nova senha</label
				>
				<input
					id="password"
					name="password"
					type="password"
					required
					minlength="6"
					autocomplete="new-password"
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
				/>
			</div>

			<div>
				<label
					for="confirm_password"
					class="block text-sm font-medium text-gray-700">Confirmar senha</label
				>
				<input
					id="confirm_password"
					name="confirm_password"
					type="password"
					required
					minlength="6"
					autocomplete="new-password"
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
				/>
			</div>

			<button
				type="submit"
				class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
			>
				Atualizar senha
			</button>
		</form>

		{#if form?.message}
			<p
				class={`text-sm text-center ${form.success ? 'text-green-700' : 'text-red-600'}`}
			>
				{form.message}
			</p>
		{/if}

		{#if form?.success}
			<div class="text-center">
				<a
					href={resolve('/login')}
					class="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
					>Ir para login</a
				>
			</div>
		{/if}
	</div>
</div>
