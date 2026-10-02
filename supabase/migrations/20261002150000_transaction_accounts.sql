-- Records which account each statement came from. Itaú and Nubank checking
-- accounts are both `bank_account`, so without this there is no way to see
-- which month of which account was never imported. transactions.source_name
-- already exists and is now filled at import time; no data is changed here.

ALTER TABLE public.transaction_imports
  ADD COLUMN IF NOT EXISTS account_name text;

CREATE INDEX IF NOT EXISTS transactions_household_source_month_idx
  ON public.transactions (household_id, source_name, reference_month);

COMMENT ON COLUMN public.transactions.source_name IS
  'Account the row was imported from (e.g. "Itaú conta", "Nubank cartão"); filled at import time.';
COMMENT ON COLUMN public.transaction_imports.account_name IS
  'Account the import was filed under; copied to transactions.source_name.';
