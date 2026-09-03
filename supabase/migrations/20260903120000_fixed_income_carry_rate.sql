-- Carry rate for bank-issued fixed income (LCA, LCI, CDB), so those papers
-- stop being dead weight in the return.
--
-- B3 publishes "Preço Atualizado CURVA" for these on every position export —
-- the accrual price for the file's date — but it does not say what the paper
-- pays: the Indexador column comes empty and there is no rate column. Without
-- that, the price stays frozen between imports and the holding is dropped from
-- any measured period, which on this portfolio meant R$ 200 mil sitting still.
--
-- So the rate is declared once per paper and the price is accrued forward from
-- the last B3 anchor by the market convention: a daily factor over 252
-- business days. Every new position import re-anchors on B3's own number, so a
-- slightly wrong rate corrects itself at the next reconciliation instead of
-- compounding.
--
-- Maturity and issue dates come from the same sheet and are stored alongside:
-- besides being the paper's identity, the maturity is what lets Tesouro Renda+
-- match the Tesouro Transparente series, whose title year is the maturity
-- (2084) and not the retirement year in the product name (2065).

ALTER TABLE public.investment_assets
  ADD COLUMN IF NOT EXISTS index_type text,
  ADD COLUMN IF NOT EXISTS index_percent numeric,
  ADD COLUMN IF NOT EXISTS index_spread numeric,
  ADD COLUMN IF NOT EXISTS issue_date date,
  ADD COLUMN IF NOT EXISTS maturity_date date;

ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_index_type_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_index_type_check
  CHECK (index_type IS NULL OR index_type IN ('cdi', 'pre', 'ipca', 'selic'));

-- A percentage of the index (96 means 96% do CDI) must be positive when set,
-- and a spread is an annual percentage that may be zero but not negative.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_index_percent_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_index_percent_check
  CHECK (index_percent IS NULL OR (index_percent > 0 AND index_percent <= 1000));

ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_index_spread_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_index_spread_check
  CHECK (index_spread IS NULL OR (index_spread >= 0 AND index_spread <= 100));

COMMENT ON COLUMN public.investment_assets.index_type IS
  'What the paper pays: cdi, selic, ipca or pre (prefixado). Null while undeclared, which keeps the holding out of measured returns.';
COMMENT ON COLUMN public.investment_assets.index_percent IS
  'Percentage of the index, as typed: 96 means 96% do CDI. For pre, the annual rate itself. Paired with index_type.';
COMMENT ON COLUMN public.investment_assets.index_spread IS
  'Annual spread added on top of the index (CDI + 1.2 stores 1.2). Null or zero when the paper is a plain percentage.';
COMMENT ON COLUMN public.investment_assets.maturity_date IS
  'Vencimento from the B3 position sheet. Also the match key for Tesouro Renda+, whose product name carries the retirement year, not the maturity.';

-- Accrued prices are computed here, not fetched, so they are marked apart from
-- the sources that publish a real quote.
ALTER TABLE public.investment_quotes
  DROP CONSTRAINT IF EXISTS investment_quotes_source_check;
ALTER TABLE public.investment_quotes
  ADD CONSTRAINT investment_quotes_source_check
  CHECK (source IN
    ('yahoo', 'tesouro_transparente', 'cvm', 'curva', 'snapshot', 'manual'));

COMMENT ON COLUMN public.investment_quotes.source IS
  'Where the price came from. "curva" is accrued locally from the declared carry rate over the CDI/Selic series, anchored on the last B3 position price.';
