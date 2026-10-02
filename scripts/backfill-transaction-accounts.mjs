// One-off backfill: names the account of rows imported before the import form
// asked for it (transactions.source_name, transaction_imports.account_name).
//
//   node --env-file=.env scripts/backfill-transaction-accounts.mjs          # dry run
//   node --env-file=.env scripts/backfill-transaction-accounts.mjs --apply  # writes
//
// Only rows whose account is still empty are touched, so it is safe to re-run.
// The naming rules live in src/lib/server/account-backfill.ts.
import {
	accountForImportFilename,
	accountForTransaction
} from '../src/lib/server/account-backfill.ts';

const PAGE_SIZE = 1000;
const PATCH_BATCH = 100;
const APPLY = process.argv.includes('--apply');

const baseUrl = process.env.PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!baseUrl || !key) {
	console.error(
		'Defina PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY (use --env-file=.env).'
	);
	process.exit(1);
}

const headers = {
	apikey: key,
	Authorization: `Bearer ${key}`,
	'Content-Type': 'application/json'
};

async function request(path, init = {}) {
	const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
		...init,
		headers: { ...headers, ...init.headers }
	});
	if (!response.ok) {
		throw new Error(
			`${init.method ?? 'GET'} ${path} -> ${response.status} ${await response.text()}`
		);
	}
	return response;
}

async function selectAll(path) {
	const rows = [];
	for (let from = 0; ; from += PAGE_SIZE) {
		const response = await request(path, {
			headers: {
				Range: `${from}-${from + PAGE_SIZE - 1}`,
				'Range-Unit': 'items'
			}
		});
		const batch = await response.json();
		rows.push(...batch);
		if (batch.length < PAGE_SIZE) return rows;
	}
}

function groupByAccount(rows, accountOf) {
	const byAccount = new Map();
	const unresolved = [];
	for (const row of rows) {
		const account = accountOf(row);
		if (!account) {
			unresolved.push(row);
			continue;
		}
		byAccount.set(account, [...(byAccount.get(account) ?? []), row.id]);
	}
	return { byAccount, unresolved };
}

async function patchInBatches(table, ids, patch, emptyColumn) {
	for (let start = 0; start < ids.length; start += PATCH_BATCH) {
		const batch = ids.slice(start, start + PATCH_BATCH);
		await request(
			`${table}?id=in.(${batch.join(',')})&${emptyColumn}=is.null`,
			{
				method: 'PATCH',
				headers: { Prefer: 'return=minimal' },
				body: JSON.stringify(patch)
			}
		);
	}
}

function report(title, { byAccount, unresolved }, describe) {
	console.log(`\n${title}`);
	for (const [account, ids] of [...byAccount].sort()) {
		console.log(`  ${String(ids.length).padStart(5)}  ${account}`);
	}
	console.log(
		`  ${String(unresolved.length).padStart(5)}  (sem conta definida)`
	);
	for (const row of unresolved.slice(0, 40))
		console.log(`         - ${describe(row)}`);
	if (unresolved.length > 40)
		console.log(`         … e mais ${unresolved.length - 40}`);
}

async function apply(table, column, grouped) {
	for (const [account, ids] of grouped.byAccount) {
		await patchInBatches(table, ids, { [column]: account }, column);
		console.log(`  gravado: ${ids.length} em ${table} -> ${account}`);
	}
}

const transactions = await selectAll(
	'transactions?select=id,source_type,description,date&source_name=is.null&order=id'
);
const imports = await selectAll(
	'transaction_imports?select=id,source_filename&account_name=is.null&order=id'
);

const transactionGroups = groupByAccount(transactions, accountForTransaction);
const importGroups = groupByAccount(imports, (row) =>
	accountForImportFilename(row.source_filename)
);

console.log(APPLY ? 'MODO APLICAR' : 'SIMULAÇÃO (nada é gravado; use --apply)');
report(
	`Transações sem conta: ${transactions.length}`,
	transactionGroups,
	(row) =>
		`${row.date} [${row.source_type ?? '?'}] ${row.description.slice(0, 60)}`
);
report(
	`Importações sem conta: ${imports.length}`,
	importGroups,
	(row) => row.source_filename
);

if (APPLY) {
	console.log('\nGravando…');
	await apply('transactions', 'source_name', transactionGroups);
	await apply('transaction_imports', 'account_name', importGroups);
	console.log('Concluído.');
}
