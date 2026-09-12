import { supabaseAdmin } from '$lib/server/supabase';

interface QuoteRow {
	household_id: string;
	asset_id: string;
	quote_date: string;
	price: number;
	source: string;
}

// Bound each database request and request a count instead of returning rows.
// A failed batch stops the run; the next cron safely revisits the same keys.
export async function writeQuoteBatches(
	rows: QuoteRow[],
	ignoreDuplicates: boolean
) {
	let written = 0;
	for (let offset = 0; offset < rows.length; offset += 200) {
		const batch = rows.slice(offset, offset + 200);
		const { count, error, status } = await supabaseAdmin
			.from('investment_quotes')
			.upsert(batch, {
				onConflict: 'asset_id,quote_date',
				ignoreDuplicates,
				count: 'exact'
			});
		if (error)
			return {
				written,
				error: `batch ${offset / 200 + 1} (${batch.length} rows, HTTP ${status}): ${error.message}`
			};
		written += count ?? 0;
	}
	return { written };
}
