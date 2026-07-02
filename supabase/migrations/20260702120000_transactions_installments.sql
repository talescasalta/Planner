-- Installment metadata parsed from credit card statement descriptions
-- (e.g. "1/6" = first of six). Used to project future installments in the
-- /app/installments view. No future rows are stored: projection is computed
-- on read from whatever installments have already been imported.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS installment_number smallint
    CHECK (installment_number IS NULL OR installment_number >= 1),
  ADD COLUMN IF NOT EXISTS installment_total smallint
    CHECK (installment_total IS NULL OR installment_total >= 1),
  ADD COLUMN IF NOT EXISTS installment_group_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_installment_range_chk'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_installment_range_chk
      CHECK (
        installment_number IS NULL
        OR installment_total IS NULL
        OR installment_number <= installment_total
      );
  END IF;
END $$;

-- Groups installments of the same purchase across statements so the projection
-- can find the latest known installment per group cheaply.
CREATE INDEX IF NOT EXISTS transactions_household_installment_group_idx
  ON public.transactions (household_id, installment_group_key)
  WHERE installment_group_key IS NOT NULL;

COMMENT ON COLUMN public.transactions.installment_number IS
  'Current installment index parsed from the statement (the k in k/n).';
COMMENT ON COLUMN public.transactions.installment_total IS
  'Total number of installments parsed from the statement (the n in k/n).';
COMMENT ON COLUMN public.transactions.installment_group_key IS
  'Stable key (merchant + total + per-installment amount) tying installments of the same purchase together across months.';
