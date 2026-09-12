-- Unifies budget, transaction and group-settlement semantics without changing
-- amounts, dates, categories or the legacy transfer flag.

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS financial_treatment text;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS financial_treatment_override text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_financial_treatment_check'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_financial_treatment_check
      CHECK (financial_treatment IS NULL OR financial_treatment IN ('operating', 'investment', 'transfer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_financial_treatment_override_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_financial_treatment_override_check
      CHECK (financial_treatment_override IS NULL OR financial_treatment_override IN ('operating', 'investment', 'transfer'));
  END IF;
END $$;

-- Preserve the old category-name rule as data, so future renames cannot alter
-- the financial meaning. The list is intentionally exact; descriptions and
-- uncategorized rows are not reclassified by this migration.
UPDATE public.categories
SET financial_treatment = 'investment'
WHERE lower(trim(name)) IN (
  'investimento', 'investimentos',
  'aplicacao financeira', 'aplicacoes financeiras',
  'aplicação financeira', 'aplicações financeiras',
  'aporte', 'aportes', 'resgate', 'resgates'
);

UPDATE public.categories
SET financial_treatment = 'operating'
WHERE lower(trim(name)) ~
  '^(rendimento|rendimentos|dividendo|dividendos|juros|jcp|imposto|impostos|ir|iof|taxa|taxas|tarifa|tarifas|corretagem|custodia|custódia)([^[:alnum:]_]|$)';

CREATE INDEX IF NOT EXISTS categories_household_financial_treatment_idx
  ON public.categories (household_id, financial_treatment);

CREATE INDEX IF NOT EXISTS transactions_household_financial_treatment_override_idx
  ON public.transactions (household_id, financial_treatment_override);

COMMENT ON COLUMN public.categories.financial_treatment IS
  'Budget treatment inherited by transactions unless a subcategory or category treatment wins.';

COMMENT ON COLUMN public.transactions.financial_treatment_override IS
  'Explicit per-transaction treatment; null inherits subcategory/category or legacy transfer.';
