-- Supersedes 20260813010000_reference_month_by_source.sql, which filed
-- statement rows under the month of their own date. That migration was never
-- applied to production; it is left in place because applied migrations are
-- immutable, and this one is written to produce the correct end state whether
-- or not it ran.
--
-- The reference month is a settlement cycle, not a calendar month: the
-- household closes a month by paying for what the previous month consumed. A
-- bank or benefit-card payment made in July is therefore settled in the August
-- cycle, one month after its own date.
--
-- Credit card invoices already work that way by themselves -- the invoice
-- closing in August bills July's purchases -- so those rows keep the invoice
-- month chosen at import and are not touched here. Rows with no source_type
-- predate the column and cannot be classified, so they are left alone too.
--
-- Deriving the cycle from each row's date rather than from the upload keeps a
-- transaction in the same cycle no matter which 60-day statement window
-- carried it, which is what makes the import dedup stable across the overlap
-- this account sees every month.

-- Moving rows between cycles can collide on the unique
-- (household_id, reference_month, import_dedup_key). Such a pair is a genuine
-- duplicate, so retain one representative and clear the key on the rest --
-- the same tie-break the original dedup backfill used, kept identical so the
-- surviving row is chosen consistently.
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
        THEN to_char(date_trunc('month', date) + interval '1 month', 'YYYY-MM')
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
SET reference_month =
  to_char(date_trunc('month', date) + interval '1 month', 'YYYY-MM')
WHERE source_type IN ('bank_account', 'vale_alimentacao', 'vale_refeicao')
  AND reference_month IS DISTINCT FROM
    to_char(date_trunc('month', date) + interval '1 month', 'YYYY-MM');

COMMENT ON COLUMN public.transactions.reference_month IS
  'Settlement cycle the row is closed in. Statement sources (bank_account, vale_alimentacao, vale_refeicao) settle one month after the transaction date; credit_card keeps the invoice month chosen at import, since the invoice already bills the previous month.';
