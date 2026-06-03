ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_type text
  CHECK (source_type IS NULL OR source_type IN ('credit_card', 'bank_account'));

ALTER TABLE public.transaction_imports
  ADD COLUMN IF NOT EXISTS source_type text
  CHECK (source_type IS NULL OR source_type IN ('credit_card', 'bank_account'));

CREATE INDEX IF NOT EXISTS transactions_household_source_type_idx
  ON public.transactions (household_id, source_type);

CREATE INDEX IF NOT EXISTS transactions_household_category_filter_idx
  ON public.transactions (household_id, category_id, subcategory_id);

CREATE INDEX IF NOT EXISTS transactions_household_review_status_idx
  ON public.transactions (household_id, review_status);
