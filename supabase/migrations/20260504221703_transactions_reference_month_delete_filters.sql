-- Store the credit-card statement/reference month on each transaction so the
-- transactions page can filter and delete by uploaded statement month.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reference_month text;

UPDATE public.transactions
SET reference_month = to_char(date, 'YYYY-MM')
WHERE reference_month IS NULL;

CREATE INDEX IF NOT EXISTS transactions_household_reference_month_idx
  ON public.transactions (household_id, reference_month);
