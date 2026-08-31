import { unzipSync } from 'fflate';
import { supabaseAdmin } from '$lib/server/supabase';
import { onlyDigits } from './investment-funds';

// Keeps a searchable copy of the CVM fund registry.
//
// It exists so that a fund is only ever identified by a row that really is
// published: the screenshot reader and the assistant pick from these
// candidates, they never compose a CNPJ. Getting that wrong is expensive and
// quiet — a wrong CNPJ still values today's balance correctly (quantity is
// derived from it) and only diverges later, following another fund's series.

const REGISTRY_URL =
	'https://dados.cvm.gov.br/dados/FI/CAD/DADOS/registro_fundo_classe.zip';

// CVM ships these files in latin-1. Decoding them as UTF-8 does not fail
// loudly: every accented byte becomes a replacement character, so "SELEÇÃO"
// stores as "SELE O" and no search for the fund's real name can ever match it.
function decodeCvm(content: Uint8Array): string {
	return new TextDecoder('latin1').decode(content);
}

export function foldForSearch(name: string): string {
	return name
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toUpperCase()
		.replace(/[^A-Z0-9+ ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export interface RegistryRow {
	cnpj: string;
	subclass_id: string;
	name: string;
	search_name: string;
	kind: string | null;
	situation: string | null;
	previdenciario: boolean;
}

function splitCsv(content: string): { header: string[]; rows: string[][] } {
	const lines = content.split('\n');
	const header = (lines.shift() ?? '').trim().split(';');
	return {
		header,
		rows: lines
			.filter((line) => line.trim() !== '')
			.map((line) => line.split(';'))
	};
}

function column(header: string[], name: string): number {
	return header.findIndex(
		(cell) => cell.trim().toLowerCase() === name.toLowerCase()
	);
}

// Classes carry the CNPJ; subclasses hang off a class and are what actually
// publish a distinct quota, so both become rows the search can return.
function cell(cells: string[], index: number): string {
	return index === -1 ? '' : (cells[index] ?? '').trim();
}

function parseClasses(csv: string): {
	rows: RegistryRow[];
	byClassId: Map<string, RegistryRow>;
} {
	const parsed = splitCsv(csv);
	const idIndex = column(parsed.header, 'ID_Registro_Classe');
	const cnpjIndex = column(parsed.header, 'CNPJ_Classe');
	const nameIndex = column(parsed.header, 'Denominacao_Social');
	const situationIndex = column(parsed.header, 'Situacao');
	const kindIndex = column(parsed.header, 'Tipo_Classe');
	const byClassId = new Map<string, RegistryRow>();
	const rows: RegistryRow[] = [];
	if (idIndex === -1 || cnpjIndex === -1 || nameIndex === -1)
		return { rows, byClassId };

	for (const cells of parsed.rows) {
		const cnpj = onlyDigits(cell(cells, cnpjIndex));
		const name = cell(cells, nameIndex);
		if (cnpj.length !== 14 || !name) continue;
		const row: RegistryRow = {
			cnpj,
			subclass_id: '',
			name,
			search_name: foldForSearch(name),
			kind: cell(cells, kindIndex) || null,
			situation: cell(cells, situationIndex) || null,
			previdenciario: false
		};
		rows.push(row);
		byClassId.set(cell(cells, idIndex), row);
	}
	return { rows, byClassId };
}

function parseSubclasses(
	csv: string,
	byClassId: Map<string, RegistryRow>
): RegistryRow[] {
	const parsed = splitCsv(csv);
	const classIdIndex = column(parsed.header, 'ID_Registro_Classe');
	const idIndex = column(parsed.header, 'ID_Subclasse');
	const nameIndex = column(parsed.header, 'Denominacao_Social');
	const situationIndex = column(parsed.header, 'Situacao');
	const prevIndex = column(parsed.header, 'Previdenciario');
	if (classIdIndex === -1 || idIndex === -1) return [];

	const rows: RegistryRow[] = [];
	for (const cells of parsed.rows) {
		const parent = byClassId.get(cell(cells, classIdIndex));
		const subclassId = cell(cells, idIndex);
		if (!parent || !subclassId) continue;
		const name = cell(cells, nameIndex) || parent.name;
		rows.push({
			cnpj: parent.cnpj,
			subclass_id: subclassId,
			name,
			search_name: foldForSearch(name),
			kind: parent.kind,
			situation: cell(cells, situationIndex) || parent.situation,
			previdenciario: cell(cells, prevIndex).toUpperCase() === 'S'
		});
	}
	return rows;
}

function isActive(row: RegistryRow): boolean {
	return (row.situation ?? '').toUpperCase().includes('FUNCIONAMENTO');
}

// The CVM file repeats a CNPJ across rows — the same fund registered more than
// once, usually with the stale copies cancelled. The primary key is
// (cnpj, subclass_id), so an upsert of a batch holding both copies fails
// outright ("cannot affect row a second time"). Keeping the operating one also
// keeps the search from offering a fund that no longer exists.
function dedupe(rows: RegistryRow[]): RegistryRow[] {
	const byKey = new Map<string, RegistryRow>();
	for (const row of rows) {
		const key = `${row.cnpj}|${row.subclass_id}`;
		const current = byKey.get(key);
		if (!current || (!isActive(current) && isActive(row))) byKey.set(key, row);
	}
	return [...byKey.values()];
}

export function parseRegistry(
	classeCsv: string,
	subclasseCsv: string
): RegistryRow[] {
	const { rows, byClassId } = parseClasses(classeCsv);
	return dedupe([...rows, ...parseSubclasses(subclasseCsv, byClassId)]);
}

export async function syncFundRegistry(
	fetcher: typeof fetch = fetch
): Promise<{ upserted: number; error?: string }> {
	try {
		const response = await fetcher(REGISTRY_URL);
		if (!response.ok)
			return { upserted: 0, error: `CVM respondeu ${response.status}` };
		const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
		const classe = files['registro_classe.csv'];
		const subclasse = files['registro_subclasse.csv'];
		if (!classe)
			return { upserted: 0, error: 'registro_classe.csv ausente no zip' };
		const rows = parseRegistry(
			decodeCvm(classe),
			subclasse ? decodeCvm(subclasse) : ''
		);
		if (rows.length === 0) return { upserted: 0, error: 'cadastro vazio' };

		let upserted = 0;
		for (let i = 0; i < rows.length; i += 1000) {
			const { error } = await supabaseAdmin
				.from('cvm_fund_registry')
				.upsert(rows.slice(i, i + 1000), { onConflict: 'cnpj,subclass_id' });
			if (error) return { upserted, error: error.message };
			upserted += Math.min(1000, rows.length - i);
		}
		return { upserted };
	} catch (error) {
		return { upserted: 0, error: String((error as Error).message) };
	}
}

export interface FundCandidate {
	cnpj: string;
	subclassId: string;
	name: string;
	previdenciario: boolean;
	situation: string | null;
}

// Brokers append the fund's legal form as an abbreviation ("FIM", "FIC",
// "RL") where the registry spells it out in full — "Kinea Atlas II FIM RL" is
// registered as "KINEA ATLAS II FUNDO DE INVESTIMENTO FINANCEIRO". Requiring
// those tokens finds nothing, so they are dropped.
const STOPWORDS =
	/^(FIC|FIF|FIM|FIA|FIP|FIDC|FII|FI|CIC|RL|LTDA|RESP|SA|DE|DO|DA|DOS|DAS|E)$/;

// Splits the query into words and requires all of them, which is what makes a
// truncated title find the right fund without matching every "Kinea" in the
// registry.
export function searchTerms(query: string): string[] {
	return foldForSearch(query)
		.split(' ')
		.filter((term) => term.length >= 2 && !STOPWORDS.test(term))
		.slice(0, 6);
}

async function runSearch(
	terms: string[],
	limit: number
): Promise<FundCandidate[]> {
	let request = supabaseAdmin
		.from('cvm_fund_registry')
		.select('cnpj, subclass_id, name, previdenciario, situation')
		.limit(limit);
	for (const term of terms) request = request.ilike('search_name', `%${term}%`);
	const { data } = await request;
	return (data ?? []).map((row) => ({
		cnpj: row.cnpj as string,
		subclassId: (row.subclass_id as string) ?? '',
		name: row.name as string,
		previdenciario: Boolean(row.previdenciario),
		situation: (row.situation as string | null) ?? null
	}));
}

// Requires every term first, then relaxes: a screenshot title can carry a word
// the registry simply does not use, and returning nothing would push the user
// into typing a CNPJ by hand — the one thing this table exists to avoid.
export async function searchFunds(
	query: string,
	limit = 8
): Promise<FundCandidate[]> {
	const terms = searchTerms(query);
	if (terms.length === 0) return [];
	const exact = await runSearch(terms, limit);
	if (exact.length > 0 || terms.length < 3) return exact;
	return runSearch(terms.slice(0, 2), limit);
}
