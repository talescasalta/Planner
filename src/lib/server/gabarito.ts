import Papa from 'papaparse';
import gabaritoCsv from './data/gabarito-default.csv?raw';

export interface GabaritoEntry {
	titulo: string;
	titulo_upper: string;
	categoria: string;
	subcategoria: string;
}

let cachedGabarito: GabaritoEntry[] | null = null;
let cachedTaxonomy: Map<string, Set<string>> | null = null;

export function loadGabarito(): GabaritoEntry[] {
	if (cachedGabarito) return cachedGabarito;

	const parseResult = Papa.parse<Record<string, string>>(gabaritoCsv, {
		header: true,
		skipEmptyLines: true
	});

	const entries: GabaritoEntry[] = [];
	for (const row of parseResult.data) {
		const titulo = row['Título']?.trim();
		const categoria = row['Categoria']?.trim();
		const subcategoria = row['Subcategoria']?.trim();
		if (!titulo || !categoria) continue;
		entries.push({
			titulo,
			titulo_upper: titulo.toUpperCase(),
			categoria,
			subcategoria: subcategoria ?? ''
		});
	}

	cachedGabarito = entries;
	return entries;
}

export function buildGabaritoPromptSection(transactions: Array<{ description: string }>): string {
	const gabarito = loadGabarito();

	const txDescriptions = new Set(transactions.map((t) => t.description.toUpperCase().trim()));

	const relevant: GabaritoEntry[] = [];
	for (const entry of gabarito) {
		for (const desc of txDescriptions) {
			if (desc.includes(entry.titulo_upper) || entry.titulo_upper.includes(desc)) {
				relevant.push(entry);
				break;
			}
		}
	}

	if (relevant.length === 0) {
		const unique = new Map<string, GabaritoEntry>();
		for (const entry of gabarito) {
			if (!unique.has(entry.titulo_upper)) {
				unique.set(entry.titulo_upper, entry);
			}
		}
		const all = Array.from(unique.values());
		for (let i = all.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[all[i], all[j]] = [all[j], all[i]];
		}
		relevant.push(...all.slice(0, 100));
	}

	const seen = new Set<string>();
	const uniqueRelevant = relevant.filter((e) => {
		if (seen.has(e.titulo_upper)) return false;
		seen.add(e.titulo_upper);
		return true;
	});

	const lines = uniqueRelevant.map(
		(e) => `- "${e.titulo}" → categoria: "${e.categoria}", subcategoria: "${e.subcategoria}"`
	);

	return `## Gabarito de classificação (referência de classificações passadas)

Use este gabarito como referência para classificar transações. Se o título da transação bater (exata ou parcialmente) com um título do gabarito, use a mesma categoria e subcategoria.

${lines.join('\n')}

Aplique a mesma lógica para transações similares não listadas acima.`;
}

export function loadGabaritoTaxonomy(): Map<string, Set<string>> {
	if (cachedTaxonomy) return cachedTaxonomy;

	const taxonomy = new Map<string, Set<string>>();
	for (const entry of loadGabarito()) {
		if (!taxonomy.has(entry.categoria)) {
			taxonomy.set(entry.categoria, new Set());
		}
		if (entry.subcategoria) {
			taxonomy.get(entry.categoria)?.add(entry.subcategoria);
		}
	}

	cachedTaxonomy = taxonomy;
	return taxonomy;
}

export function filterCategoriesByGabarito<
	T extends { id: string; name: string; parent_id: string | null; created_by_user_id?: string | null }
>(categories: T[]): T[] {
	return filterCategoriesForUser(categories, null);
}

export function filterCategoriesForUser<
	T extends { id: string; name: string; parent_id: string | null; created_by_user_id?: string | null }
>(
	categories: T[],
	userId: string | null,
	excludedCategoryIds: Iterable<string> = [],
	includeCategoryIds: Iterable<string> = []
): T[] {
	const taxonomy = loadGabaritoTaxonomy();
	const parentById = new Map(categories.filter((c) => !c.parent_id).map((c) => [c.id, c]));
	const excluded = new Set(excludedCategoryIds);
	const included = new Set(includeCategoryIds);
	for (const id of Array.from(included)) {
		const category = categories.find((c) => c.id === id);
		if (category?.parent_id) included.add(category.parent_id);
	}
	const allowedParentIds = new Set<string>();

	const parents = categories.filter((category) => {
		if (category.parent_id) return false;
		if (excluded.has(category.id) && !included.has(category.id)) return false;
		const isAllowed = taxonomy.has(category.name) || (!!userId && category.created_by_user_id === userId);
		if (isAllowed) allowedParentIds.add(category.id);
		return isAllowed;
	});

	const children = categories.filter((category) => {
		if (!category.parent_id || !allowedParentIds.has(category.parent_id)) return false;
		if (excluded.has(category.id) && !included.has(category.id)) return false;
		if (!!userId && category.created_by_user_id === userId) return true;

		const parent = parentById.get(category.parent_id);
		if (!parent) return false;
		return taxonomy.get(parent.name)?.has(category.name) ?? false;
	});

	return [...parents, ...children];
}

export function buildUserTaxonomyPromptSection(
	categories: Array<{ id: string; name: string; parent_id: string | null; created_by_user_id?: string | null }>,
	userId: string
): string {
	const personalParents = categories.filter((c) => !c.parent_id && c.created_by_user_id === userId);
	const personalChildren = categories.filter((c) => c.parent_id && c.created_by_user_id === userId);
	if (personalParents.length === 0 && personalChildren.length === 0) return '';

	const childrenByParent = new Map<string, string[]>();
	for (const child of personalChildren) {
		const arr = childrenByParent.get(child.parent_id!) ?? [];
		arr.push(child.name);
		childrenByParent.set(child.parent_id!, arr);
	}

	const parentById = new Map(categories.filter((c) => !c.parent_id).map((c) => [c.id, c.name]));
	const lines = [
		...personalParents.map((parent) => {
			const subs = childrenByParent.get(parent.id) ?? [];
			return subs.length > 0 ? `- ${parent.name}: ${subs.join(', ')}` : `- ${parent.name}`;
		}),
		...personalChildren
			.filter((child) => !personalParents.some((parent) => parent.id === child.parent_id))
			.map((child) => `- ${parentById.get(child.parent_id!) ?? 'Categoria'}: ${child.name}`)
	];

	return `## Categorias pessoais do usuário

Estas categorias/subcategorias foram criadas manualmente pelo usuário e devem ser priorizadas quando fizerem sentido:

${lines.join('\n')}`;
}
