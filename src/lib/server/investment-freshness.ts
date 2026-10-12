// How current the B3 data is. The user's ritual is a monthly movimentação
// import, so the nudge keys off that file kind: positions and negociações
// alone do not bring in proventos, transfers or the month's other events.

export const STALE_AFTER_DAYS = 35;

export interface ImportStamp {
	sourceType: string;
	createdAt: string;
}

export interface ImportFreshness {
	lastImportAt: string | null;
	lastMovimentacaoAt: string | null;
	daysSinceMovimentacao: number | null;
	stale: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function latest(stamps: ImportStamp[], kinds: string[]): string | null {
	let best: string | null = null;
	for (const stamp of stamps) {
		if (!kinds.includes(stamp.sourceType)) continue;
		if (best === null || stamp.createdAt > best) best = stamp.createdAt;
	}
	return best;
}

export function importFreshness(
	stamps: ImportStamp[],
	now: Date = new Date()
): ImportFreshness {
	const lastImportAt = latest(stamps, [
		'b3_posicao',
		'b3_negociacao',
		'b3_movimentacao'
	]);
	const lastMovimentacaoAt = latest(stamps, ['b3_movimentacao']);
	if (!lastMovimentacaoAt) {
		return {
			lastImportAt,
			lastMovimentacaoAt: null,
			daysSinceMovimentacao: null,
			// Nothing imported at all is the onboarding state, not staleness.
			stale: lastImportAt !== null
		};
	}
	const days = Math.max(
		0,
		Math.floor(
			(now.getTime() - new Date(lastMovimentacaoAt).getTime()) / DAY_MS
		)
	);
	return {
		lastImportAt,
		lastMovimentacaoAt,
		daysSinceMovimentacao: days,
		stale: days > STALE_AFTER_DAYS
	};
}
