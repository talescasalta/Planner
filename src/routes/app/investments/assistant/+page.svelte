<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	let asking = $state(false);
	let question = $state('');

	let history = $derived(form?.history ?? []);
	let proposal = $derived(form?.proposal ?? null);

	const brl = new Intl.NumberFormat('pt-BR', {
		style: 'currency',
		currency: 'BRL'
	});

	const examples = [
		'Quanto meus investimentos renderam em agosto?',
		'Quero cadastrar o Nu Reserva Imediata, tenho R$ 98.720,99 e apliquei R$ 61.208,05',
		'Tenho DARF para pagar?'
	];
</script>

<svelte:head>
	<title>Assistente de investimentos</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-4 p-4">
	<div>
		<h2 class="text-sm font-semibold text-gray-900">
			Assistente de investimentos
		</h2>
		<p class="mt-1 text-sm text-gray-600">
			Pergunte sobre a sua carteira ou descreva um investimento novo para
			cadastrar.
		</p>
		<p class="mt-1 text-xs text-gray-500">
			O assistente lê os seus dados e propõe — nunca grava sozinho, e o CNPJ de
			um fundo sempre vem do cadastro da CVM, nunca da resposta dele.
		</p>
	</div>

	{#if history.length === 0}
		<div class="rounded-lg border border-gray-200 bg-white p-4">
			<p class="text-xs text-gray-500">Por exemplo:</p>
			<ul class="mt-2 space-y-1">
				{#each examples as example (example)}
					<li>
						<button
							type="button"
							class="text-left text-sm text-blue-700 underline"
							onclick={() => (question = example)}
						>
							{example}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#each history as turn, index (index)}
		<div
			class={turn.role === 'user'
				? 'ml-8 rounded-lg bg-blue-50 p-3 text-sm text-blue-950'
				: 'mr-8 rounded-lg border border-gray-200 bg-white p-3 text-sm whitespace-pre-line text-gray-800'}
		>
			{turn.content}
		</div>
	{/each}

	{#if form && form.success === false}
		<div
			class="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"
		>
			{form.message}
		</div>
	{/if}

	{#if proposal}
		<div class="rounded-lg border border-green-300 bg-green-50 p-4">
			<h2 class="text-sm font-semibold text-green-900">Proposta de cadastro</h2>
			<dl class="mt-2 space-y-1 text-sm text-green-900">
				<div>
					<dt class="inline font-medium">Fundo:</dt>
					{proposal.name}
				</div>
				<div>
					<dt class="inline font-medium">No cadastro da CVM:</dt>
					{proposal.registryName}
				</div>
				<div>
					<dt class="inline font-medium">CNPJ:</dt>
					{proposal.cnpj}{proposal.subclassId
						? ` · subclasse ${proposal.subclassId}`
						: ''}
				</div>
				<div>
					<dt class="inline font-medium">Saldo:</dt>
					{brl.format(proposal.balance)}
					{#if proposal.applied !== null}
						· <dt class="inline font-medium">aplicado:</dt>
						{brl.format(proposal.applied)}
					{/if}
				</div>
				<div>
					<dt class="inline font-medium">Tipo:</dt>
					{proposal.kind === 'previdencia' ? 'Previdência' : 'Fundo'}
				</div>
			</dl>
			<p class="mt-2 text-xs text-green-800">
				Confira o CNPJ acima antes de salvar — é ele que define qual cota o app
				vai acompanhar daqui pra frente.
			</p>
			<a
				href={resolve('/app/investments/funds')}
				class="mt-3 inline-block rounded bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800"
			>
				Abrir a tela de fundos para salvar
			</a>
		</div>
	{/if}

	<form
		method="POST"
		action="?/ask"
		use:enhance={() => {
			asking = true;
			return async ({ update }) => {
				asking = false;
				question = '';
				await update({ reset: false });
			};
		}}
		class="rounded-lg border border-gray-200 bg-white p-3"
	>
		<input type="hidden" name="history" value={JSON.stringify(history)} />
		<textarea
			name="question"
			bind:value={question}
			rows="3"
			required
			placeholder="Pergunte alguma coisa sobre a sua carteira…"
			class="block w-full rounded border border-gray-300 px-2 py-1 text-sm"
		></textarea>
		<div class="mt-2 flex items-center justify-end">
			<button
				type="submit"
				disabled={asking}
				class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
			>
				{asking ? 'Pensando…' : 'Enviar'}
			</button>
		</div>
	</form>
</div>
