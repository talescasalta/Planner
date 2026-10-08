export const MAX_OWN_NAMES = 10;
export const MIN_OWN_NAME_CHARS = 3;
export const MAX_OWN_NAME_CHARS = 60;

// Lower case, no accents, single spaces: how names are compared.
export function foldForMatch(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type OwnNamesParse =
	{ names: string[]; error?: undefined } | { names?: undefined; error: string };

// One name per line, as typed in Configurações. Kept in the spelling the user
// gave; duplicates ignoring case and accents are dropped.
export function parseOwnNames(input: string): OwnNamesParse {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const line of input.split(/\r?\n/)) {
		const name = line.trim().replace(/\s+/g, ' ');
		if (!name) continue;
		if (name.length < MIN_OWN_NAME_CHARS || name.length > MAX_OWN_NAME_CHARS) {
			return {
				error: `Cada nome precisa ter entre ${MIN_OWN_NAME_CHARS} e ${MAX_OWN_NAME_CHARS} letras: "${name}".`
			};
		}
		const folded = foldForMatch(name);
		if (seen.has(folded)) continue;
		seen.add(folded);
		names.push(name);
	}
	if (names.length > MAX_OWN_NAMES) {
		return { error: `Informe no máximo ${MAX_OWN_NAMES} nomes.` };
	}
	return { names };
}

// True when the description carries one of the names as whole words: "Maria S"
// matches "PIX TRANSF Maria S03/09" (a digit follows) but not "Maria Santos",
// and "Maria Silva" matches inside a longer Nubank line.
export function mentionsOwnName(
	description: string,
	names: readonly string[]
): boolean {
	const text = foldForMatch(description);
	return names.some((name) => {
		const folded = foldForMatch(name);
		if (!folded) return false;
		const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(folded)}(?![a-z])`);
		return pattern.test(text);
	});
}
