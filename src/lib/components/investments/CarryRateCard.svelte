<script lang="ts">
	import { enhance } from '$app/forms';
	import { brl, dateBr } from '$lib/investments/format';

	// Bank-issued paper (LCA, LCI, CDB) has no published quote. B3 restates its
	// accrued price on every position export and then says nothing until the
	// next one, so without the carry rate the holding sits frozen and drops out
	// of every measured period. This asks for the rate, and keeps asking.

	interface CarryPosition {
		assetId: string;
		label: string;
		name: string;
		value: number;
		maturityDate: string | null;
		indexType: string | null;
		indexPercent: number | null;
		indexSpread: number | null;
		needsCarryRate: boolean;
	}

	let {
		positions,
		message = null
	}: { positions: CarryPosition[]; message?: string | null } = $props();

	let pending = $derived(positions.filter((p) => p.needsCarryRate));
	let declared = $derived(positions.filter((p) => !p.needsCarryRate));
	let pendingValue = $derived(pending.reduce((sum, p) => sum + p.value, 0));

	// Which paper's form is open. One at a time keeps the card compact.
	let editing = $state<string | null>(null);
	let indexType = $state('cdi');

	function open(position: CarryPosition) {
		editing = position.assetId;
		indexType = position.indexType === 'pre' ? 'pre' : 'cdi';
	}

	const rateLabel = (position: CarryPosition) => {
		if (position.indexType === 'pre') {
			return `${position.indexPercent}% a.a. prefixado`;
		}
		const base = `${position.indexPercent}% do CDI`;
		return position.indexSpread
			? `${base} + ${position.indexSpread}% a.a.`
			: base;
	};
</script>

{#if positions.length > 0}
	<div class="rounded-lg border border-gray-200 bg-white p-4">
		<div class="flex flex-wrap items-baseline justify-between gap-2">
			<h2 class="text-sm font-semibold text-gray-900">Taxa de carrego</h2>
			{#if pending.length > 0}
				<p class="text-xs text-amber-700">
					{pending.length}
					{pending.length === 1 ? 'papel sem taxa' : 'papéis sem taxa'} · {brl(
						pendingValue
					)}
				</p>
			{/if}
		</div>
		<p class="mt-1 text-xs text-gray-500">
			LCA, LCI e CDB não têm cotação pública. Com a taxa informada, o preço é
			atualizado na curva a cada dia útil, em base 252 — sem ela, o papel fica
			parado no último valor da B3 e fora do rendimento do mês.
		</p>

		{#if message}
			<p
				class="mt-2 rounded border border-gray-200 bg-gray-50 p-2 text-xs text-gray-700"
			>
				{message}
			</p>
		{/if}

		<ul class="mt-3 divide-y divide-gray-100">
			{#each [...pending, ...declared] as position (position.assetId)}
				<li class="py-2">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-gray-900">
								{position.name}
							</p>
							<p class="text-xs text-gray-500">
								{brl(position.value)}{position.maturityDate
									? ` · vence em ${dateBr(position.maturityDate)}`
									: ''}
							</p>
						</div>
						<div class="flex items-center gap-2">
							{#if position.needsCarryRate}
								<span class="text-xs text-amber-700">sem taxa</span>
							{:else}
								<span class="text-xs text-gray-700">{rateLabel(position)}</span>
							{/if}
							<button
								type="button"
								class="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
								onclick={() =>
									(editing =
										editing === position.assetId ? null : position.assetId) &&
									open(position)}
							>
								{position.needsCarryRate ? 'Informar' : 'Alterar'}
							</button>
						</div>
					</div>

					{#if editing === position.assetId}
						<form
							method="POST"
							action="?/set_carry_rate"
							use:enhance={() => {
								return async ({ update }) => {
									editing = null;
									await update();
								};
							}}
							class="mt-2 flex flex-wrap items-end gap-2 rounded bg-gray-50 p-2"
						>
							<input type="hidden" name="asset_id" value={position.assetId} />
							<label class="text-xs text-gray-600">
								<span class="block">Indexador</span>
								<select
									name="index_type"
									bind:value={indexType}
									class="mt-0.5 rounded border border-gray-300 px-2 py-1 text-sm"
								>
									<option value="cdi">% do CDI</option>
									<option value="pre">Prefixado (% a.a.)</option>
								</select>
							</label>
							<label class="text-xs text-gray-600">
								<span class="block"
									>{indexType === 'cdi' ? '% do CDI' : 'Taxa anual'}</span
								>
								<input
									name="index_percent"
									inputmode="decimal"
									placeholder={indexType === 'cdi' ? '96' : '12'}
									value={position.indexPercent ?? ''}
									class="mt-0.5 w-24 rounded border border-gray-300 px-2 py-1 text-sm"
								/>
							</label>
							{#if indexType === 'cdi'}
								<label class="text-xs text-gray-600">
									<span class="block">Spread a.a. (opcional)</span>
									<input
										name="index_spread"
										inputmode="decimal"
										placeholder="0"
										value={position.indexSpread ?? ''}
										class="mt-0.5 w-28 rounded border border-gray-300 px-2 py-1 text-sm"
									/>
								</label>
							{/if}
							<button
								type="submit"
								class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
							>
								Salvar
							</button>
							<button
								type="button"
								class="px-2 py-1.5 text-xs text-gray-600 hover:text-gray-900"
								onclick={() => (editing = null)}
							>
								Cancelar
							</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}
