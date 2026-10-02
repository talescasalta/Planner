-- Splits credits by meaning so the savings rate only divides by earned income:
--   income            salary and benefits (the savings-rate denominator)
--   investment_income dividends, interest and amortization (reinvestment, not
--                     new savings)
--   operating         consumption; credits here are refunds netted against
--                     expenses
-- Amounts, dates and categories are untouched.

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_financial_treatment_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_financial_treatment_check
  CHECK (
    financial_treatment IS NULL
    OR financial_treatment IN ('operating', 'income', 'investment', 'investment_income', 'transfer')
  );

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_financial_treatment_override_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_financial_treatment_override_check
  CHECK (
    financial_treatment_override IS NULL
    OR financial_treatment_override IN ('operating', 'income', 'investment', 'investment_income', 'transfer')
  );

-- 20260912194902 marked investment returns as operating so they stayed in
-- income. Operating credits are now refunds, so move them to their own
-- treatment instead of letting them silently shrink expenses.
UPDATE public.categories
SET financial_treatment = 'investment_income'
WHERE financial_treatment = 'operating'
  AND lower(trim(name)) ~
    '^(rendimento|rendimentos|dividendo|dividendos|juros|jcp|provento|proventos|amortizacao|amortização)([^[:alnum:]_]|$)';

-- Same exact-name approach as 20260912194902 for the unambiguous salary and
-- own-account transfer categories; anything else stays for the user to set.
UPDATE public.categories
SET financial_treatment = 'income'
WHERE financial_treatment IS NULL
  AND lower(trim(name)) IN (
    'salario', 'salário', 'salarios', 'salários',
    'pro-labore', 'pró-labore', 'prolabore', 'pró labore'
  );

UPDATE public.categories
SET financial_treatment = 'transfer'
WHERE financial_treatment IS NULL
  AND lower(trim(name)) IN (
    'transferencia', 'transferência', 'transferencias', 'transferências',
    'entre contas'
  );

COMMENT ON COLUMN public.categories.financial_treatment IS
  'operating (expenses; credits are refunds), income (earned income), investment (aporte/resgate), investment_income (proventos) or transfer. Inherited by transactions unless a subcategory or row override wins.';
