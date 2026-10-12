-- Holdings denominated in a foreign currency, starting with the Wise Rende+
-- balance: a dollar money-market fund (ISIN IE00B45H7020) that the Wise app
-- buys into automatically with whatever lands in the USD balance.
--
-- The rest of the module reasons in reais — positions, returns, the monthly
-- curve — so the BRL figures stay in the existing columns and every consumer
-- keeps working untouched. What is new is the native side kept alongside it:
-- the fund's own quota in dollars, which is what the statement and the app
-- screen actually report and what the valuation accrues from. Reais come from
-- multiplying that by the PTAX of the day.

ALTER TABLE public.investment_assets
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS isin text;

ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_currency_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_currency_check
  CHECK (currency IN ('BRL', 'USD', 'EUR', 'GBP'));

COMMENT ON COLUMN public.investment_assets.currency IS
  'Currency the asset is quoted in. BRL for everything bought in Brazil; for the others, native prices sit in the native_* columns and the BRL ones are converted at PTAX.';
COMMENT ON COLUMN public.investment_assets.isin IS
  'ISIN of a foreign fund, as the Wise statement reports it. Null for domestic assets.';

-- A class and a tax bucket of their own: income abroad is declared once a year
-- (Lei 14.754/2023), never through the monthly DARF, so the apuração must leave
-- it out just like the buckets taxed at source.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_asset_class_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_asset_class_check
  CHECK (asset_class IN
    ('etf', 'fii', 'acao', 'fundo', 'previdencia', 'tesouro', 'cdb', 'lca_lci', 'exterior', 'outro'));

ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_tax_bucket_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_tax_bucket_check
  CHECK (tax_bucket IN ('fii', 'acoes', 'etf_rv', 'retido_fonte', 'isento', 'exterior'));

-- Native amounts next to the BRL ones.
ALTER TABLE public.investment_events
  ADD COLUMN IF NOT EXISTS native_unit_price numeric,
  ADD COLUMN IF NOT EXISTS native_total_value numeric;
ALTER TABLE public.investment_quotes
  ADD COLUMN IF NOT EXISTS native_price numeric;

COMMENT ON COLUMN public.investment_quotes.native_price IS
  'Price in the asset''s own currency, for foreign assets. price is this times the PTAX of quote_date (or of the last business day before it).';

ALTER TABLE public.investment_events
  DROP CONSTRAINT IF EXISTS investment_events_source_check;
ALTER TABLE public.investment_events
  ADD CONSTRAINT investment_events_source_check
  CHECK (source IN ('b3_movimentacao', 'b3_negociacao', 'manual', 'wise_extrato'));

-- "wise" marks a quota stated by Wise itself (a trade in the statement or a
-- balance read from the app); "exterior" is accrued from it locally, the same
-- way "curva" is for bank-issued paper.
ALTER TABLE public.investment_quotes
  DROP CONSTRAINT IF EXISTS investment_quotes_source_check;
ALTER TABLE public.investment_quotes
  ADD CONSTRAINT investment_quotes_source_check
  CHECK (source IN
    ('yahoo', 'tesouro_transparente', 'cvm', 'curva', 'snapshot', 'manual', 'wise', 'exterior'));

ALTER TABLE public.transaction_imports
  DROP CONSTRAINT IF EXISTS transaction_imports_source_type_check;
ALTER TABLE public.transaction_imports
  ADD CONSTRAINT transaction_imports_source_type_check
  CHECK (source_type IS NULL OR source_type IN
    ('credit_card', 'bank_account', 'vale_alimentacao', 'vale_refeicao',
     'b3_posicao', 'b3_negociacao', 'b3_movimentacao', 'wise_extrato'));

-- ============================================================
-- fx_daily_rates — public market data, not household-scoped
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fx_daily_rates (
  currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  rate_date date NOT NULL,
  rate numeric NOT NULL CHECK (rate > 0),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (currency, rate_date)
);

COMMENT ON TABLE public.fx_daily_rates IS
  'PTAX de venda from Banco Central SGS (series 1 for USD, 21620 for EUR, 21624 for GBP), one row per business day. Public reference data: every authenticated user reads the same rows, and only the cron (service role) writes.';
COMMENT ON COLUMN public.fx_daily_rates.rate IS
  'Reais per one unit of the currency, as BCB publishes it.';

ALTER TABLE public.fx_daily_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fx_daily_rates_select" ON public.fx_daily_rates;
CREATE POLICY "fx_daily_rates_select"
  ON public.fx_daily_rates
  FOR SELECT
  TO authenticated
  USING (true);
