-- Supersedes 20260813020000_reference_month_settlement_cycle.sql, which filed
-- every row in the cycle that pays for it. That answered "quanto vou pagar
-- neste mês"; this one answers "quanto gastei neste mês", which is the
-- question the app is actually asked and the convention every other personal
-- finance product follows.
--
-- Bank and benefit-card rows go back to the month of their own date: a
-- purchase on 15/08 belongs to August, not to the September cycle that settles
-- it. Manual transactions already worked this way — transactions/new files
-- them under the date's month — so this also removes a quiet inconsistency
-- between a row typed by hand and the same row arriving by import.
--
-- Credit card rows stay whole as an invoice, but the invoice is now labelled
-- by the month it CLOSES rather than the month it is due. On this household's
-- card, closing on the 26th and due on the 3rd, the invoice covering 27/07 to
-- 26/08 was filed under September and is now filed under August — next to the
-- August statement instead of a month ahead of it.
--
-- Both changes move every existing row exactly one month back, verified over
-- the full table before writing this: nothing is regrouped, only relabelled.
-- The collision guard below is kept anyway, because a rule that depends on
-- source_type can meet a row that never followed the old pattern.

-- Moving rows between months can collide on the unique
-- (household_id, reference_month, import_dedup_key). Such a pair is a genuine
-- duplicate, so retain one representative and clear the key on the rest --
-- the same tie-break the earlier backfills used, kept identical so the
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
        THEN to_char(date, 'YYYY-MM')
      WHEN source_type = 'credit_card'
        AND reference_month ~ '^\d{4}-\d{2}$'
        THEN to_char(
          to_date(reference_month, 'YYYY-MM') - interval '1 month', 'YYYY-MM'
        )
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

-- Statement sources: the month of the row's own date.
UPDATE public.transactions
SET reference_month = to_char(date, 'YYYY-MM')
WHERE source_type IN ('bank_account', 'vale_alimentacao', 'vale_refeicao')
  AND reference_month IS DISTINCT FROM to_char(date, 'YYYY-MM');

-- Credit card: from the month the invoice was due to the month it closed.
-- Guarded by a well-formed reference_month so a malformed value is left alone
-- rather than turned into null by to_date.
UPDATE public.transactions
SET reference_month = to_char(
  to_date(reference_month, 'YYYY-MM') - interval '1 month', 'YYYY-MM'
)
WHERE source_type = 'credit_card'
  AND reference_month ~ '^\d{4}-\d{2}$';

COMMENT ON COLUMN public.transactions.reference_month IS
  'Month the spending is reported in. Statement sources (bank_account, vale_alimentacao, vale_refeicao) use the month of the transaction date; credit_card uses the month the invoice closed, chosen at import.';
