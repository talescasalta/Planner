-- Allow vale alimentação / vale refeição as import source types.
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_source_type_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('credit_card', 'bank_account', 'vale_alimentacao', 'vale_refeicao'));

ALTER TABLE public.transaction_imports
  DROP CONSTRAINT IF EXISTS transaction_imports_source_type_check;
ALTER TABLE public.transaction_imports
  ADD CONSTRAINT transaction_imports_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('credit_card', 'bank_account', 'vale_alimentacao', 'vale_refeicao'));
