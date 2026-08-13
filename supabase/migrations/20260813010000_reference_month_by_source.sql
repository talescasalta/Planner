-- Reference month now depends on where the rows came from.
--
-- Bank and benefit-card statements list transactions by the day they happened,
-- so each row belongs to the month of its own date. Until now every row in an
-- import inherited the single month picked at upload time, which filed a
-- 60-day statement's June and July activity under August.
--
-- Credit card invoices are the opposite: a purchase belongs to the invoice that
-- billed it regardless of when it was made, so those rows keep the chosen
-- month and are left untouched here. Rows with no source_type predate the
-- column and cannot be classified, so they are left untouched as well.

-- Moving rows between months can push two of them onto the same
-- (household_id, reference_month, import_dedup_key) slot, which the unique
-- index forbids. Such a pair is a genuine duplicate, so retain one
-- representative and clear the key on the rest -- the same tie-break the
-- original dedup backfill used, kept identical so the surviving row is chosen
-- consistently.
WITH final_state AS (
  SELECT
    id,
    household_id,
    import_dedup_key,
    category_id,
    subcategory_id,
    review_status,
    created_at,
    CASE
      WHEN source_type IN ('bank_account', 'vale_alimentacao', 'vale_refeicao')
        THEN to_char(date, 'YYYY-MM')
      ELSE reference_month
    END AS resolved_reference_month
  FROM public.transactions
  WHERE import_dedup_key IS NOT NULL
),
ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY household_id, resolved_reference_month, import_dedup_key
      ORDER BY
        CASE WHEN subcategory_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN category_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN review_status = 'confirmed' THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
    ) AS rn
  FROM final_state
)
UPDATE public.transactions t
SET import_dedup_key = NULL
FROM ranked
WHERE t.id = ranked.id
  AND ranked.rn > 1;

UPDATE public.transactions
SET reference_month = to_char(date, 'YYYY-MM')
WHERE source_type IN ('bank_account', 'vale_alimentacao', 'vale_refeicao')
  AND reference_month IS DISTINCT FROM to_char(date, 'YYYY-MM');

COMMENT ON COLUMN public.transactions.reference_month IS
  'Month the row is reported under. Statement sources (bank_account, vale_alimentacao, vale_refeicao) derive it from the transaction date; credit_card keeps the invoice month chosen at import.';
