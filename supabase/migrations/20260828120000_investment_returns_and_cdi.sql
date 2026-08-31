-- Portfolio performance measured against the CDI.
--
-- B3 gives one position snapshot at a time, so there is no history of what the
-- portfolio was worth. From here on the daily quotes the cron already stores
-- supply it: the value on any past date is the quantity derived for that date
-- times the quote of that date, recomputed on demand. That matters because
-- movimentação is imported a month late — a stored valuation would credit an
-- old purchase as the import day's gain, while a derived one simply corrects
-- itself. The only new table is the CDI series to benchmark against; returns
-- before the first quote are answered by a money-weighted rate over the event
-- history instead.
--
-- Also swaps the ticker quote source: brapi.dev now requires a paid token for
-- every request, so listed prices come from Yahoo Finance instead.

-- ============================================================
-- cdi_daily_rates — public market data, not household-scoped
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cdi_daily_rates (
  rate_date date PRIMARY KEY,
  rate numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE public.cdi_daily_rates IS
  'CDI daily rate from Banco Central SGS series 12, one row per business day. Public reference data: every authenticated user reads the same rows, and only the cron (service role) writes.';
COMMENT ON COLUMN public.cdi_daily_rates.rate IS
  'Percent per business day exactly as BCB publishes it (e.g. 0.051660), not a fraction.';

ALTER TABLE public.cdi_daily_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cdi_daily_rates_select" ON public.cdi_daily_rates;
CREATE POLICY "cdi_daily_rates_select"
  ON public.cdi_daily_rates
  FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================
-- investment_quotes: brapi.dev went paid, Yahoo Finance replaces it
-- ============================================================

ALTER TABLE public.investment_quotes
  DROP CONSTRAINT IF EXISTS investment_quotes_source_check;
ALTER TABLE public.investment_quotes
  ADD CONSTRAINT investment_quotes_source_check
  CHECK (source IN ('yahoo', 'tesouro_transparente', 'snapshot', 'manual'));
