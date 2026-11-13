// Shared by the transactions list's server load (which filters the whole
// month before paging) and the page (which filters instantly while the user
// types). Accents are ignored so "transferencia" finds "Transferência".

/** Longest term the list accepts; longer input is cut, not rejected. */
export const MAX_SEARCH_LENGTH = 100;

export type SearchableTransaction = {
	description?: string | null;
	clean_description?: string | null;
	category_display_name?: string | null;
	subcategory_display_name?: string | null;
};

function normalizeSearchText(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.trim();
}

export function cleanSearchTerm(value: string | null | undefined): string {
	return (value ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
}

export function matchesSearch(
	transaction: SearchableTransaction,
	term: string
): boolean {
	const needle = normalizeSearchText(term);
	if (!needle) return true;
	return [
		transaction.description,
		transaction.clean_description,
		transaction.category_display_name,
		transaction.subcategory_display_name
	].some((field) => normalizeSearchText(field).includes(needle));
}
