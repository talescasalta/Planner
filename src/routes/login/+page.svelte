<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let isSignUp = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
	<div class="w-full max-w-sm space-y-6">
		<h1 class="text-2xl font-semibold text-center text-gray-900">
			{isSignUp ? 'Cadastrar' : 'Entrar'}
		</h1>

		<form method="POST" use:enhance class="space-y-4">
			{#if isSignUp}
				<input type="hidden" name="action" value="signup" />
			{:else}
				<input type="hidden" name="action" value="login" />
			{/if}

			<div>
				<label for="email" class="block text-sm font-medium text-gray-700">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
				/>
			</div>

			<div>
				<label for="password" class="block text-sm font-medium text-gray-700">Senha</label>
				<input
					id="password"
					name="password"
					type="password"
					required
					minlength="6"
					class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2"
				/>
			</div>

			<button
				type="submit"
				class="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
			>
				{isSignUp ? 'Cadastrar' : 'Entrar'}
			</button>
		</form>

		{#if form && !form.success}
			<p class="text-sm text-red-600 text-center">{form.message}</p>
		{/if}
		{#if form?.success && isSignUp}
			<p class="text-sm text-green-600 text-center">{form.message}</p>
		{/if}

		<div class="text-center">
			<button
				type="button"
				class="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
				onclick={() => (isSignUp = !isSignUp)}
			>
				{isSignUp ? 'Já tem conta? Entrar' : 'Não tem conta? Cadastrar'}
			</button>
		</div>
	</div>
</div>
