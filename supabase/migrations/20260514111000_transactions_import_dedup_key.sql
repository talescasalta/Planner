-- Canonical import key used to make statement imports idempotent.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS import_dedup_key text;

WITH canonical AS (
  SELECT
    id,
    household_id,
    reference_month,
    concat_ws(
      '|',
      date::text,
      upper(regexp_replace(coalesce(clean_description, description), '[[:space:]]+', ' ', 'g')),
      to_char(amount, 'FM999999999999990.00'),
      coalesce(currency, 'BRL')
    ) AS key,
    row_number() OVER (
      PARTITION BY
        household_id,
        reference_month,
        concat_ws(
          '|',
          date::text,
          upper(regexp_replace(coalesce(clean_description, description), '[[:space:]]+', ' ', 'g')),
          to_char(amount, 'FM999999999999990.00'),
          coalesce(currency, 'BRL')
        )
      ORDER BY
        CASE WHEN subcategory_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN category_id IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN review_status = 'confirmed' THEN 0 ELSE 1 END,
        created_at ASC,
        id ASC
    ) AS rn
  FROM public.transactions
)
UPDATE public.transactions t
SET import_dedup_key = CASE WHEN canonical.rn = 1 THEN canonical.key ELSE NULL END
FROM canonical
WHERE t.id = canonical.id
  AND t.import_dedup_key IS NULL;

-- Conflict inspection query for production review, if needed:
-- SELECT household_id, reference_month, import_dedup_key, count(*)
-- FROM public.transactions
-- WHERE import_dedup_key IS NOT NULL
-- GROUP BY household_id, reference_month, import_dedup_key
-- HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_import_dedup_unique_idx
  ON public.transactions (household_id, reference_month, import_dedup_key);

COMMENT ON COLUMN public.transactions.import_dedup_key IS
  'Canonical key for imported statement rows. Duplicates detected during backfill keep this NULL except for one retained representative.';
