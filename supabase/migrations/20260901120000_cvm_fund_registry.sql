-- Local mirror of the CVM fund registry, so a fund can be found by name.
--
-- Screenshots show commercial names ("Nu Reserva Imediata"), truncated at
-- that ("Kinea Atlas II FIM RL - Subc..."), while the CNPJ that prices the
-- holding lives under a legal name ("NU RESERVA IMEDIATA FIF CIC RENDA FIXA
-- REFERENCIADO DI RESPONSABILIDADE LIMITADA"). Bridging the two needs a
-- searchable table: the source is a 16 MB zip of 36k classes, far too heavy to
-- fetch on every lookup.
--
-- This exists so that neither the assistant nor the screenshot reader ever
-- writes a CNPJ of its own: they choose among rows that are actually here.

CREATE TABLE IF NOT EXISTS public.cvm_fund_registry (
  cnpj text NOT NULL,
  subclass_id text NOT NULL DEFAULT '',
  name text NOT NULL,
  search_name text NOT NULL,
  kind text,
  situation text,
  previdenciario boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (cnpj, subclass_id)
);

COMMENT ON TABLE public.cvm_fund_registry IS
  'Funds and subclasses published by CVM. Public reference data: every authenticated user searches the same rows, and only the cron (service role) writes.';
COMMENT ON COLUMN public.cvm_fund_registry.search_name IS
  'Denominação social folded to uppercase without accents, so a lookup can match what a broker screenshot spells.';
COMMENT ON COLUMN public.cvm_fund_registry.subclass_id IS
  'CVM ID_SUBCLASSE, empty string when the fund publishes a single quota. Part of the key because subclasses of one CNPJ carry different quotas.';

ALTER TABLE public.cvm_fund_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cvm_fund_registry_select" ON public.cvm_fund_registry;
CREATE POLICY "cvm_fund_registry_select"
  ON public.cvm_fund_registry
  FOR SELECT
  TO authenticated
  USING (true);

-- A plain index serves prefix lookups; the table is ~36k short rows, so the
-- substring searches a screenshot needs scan it in milliseconds and do not
-- justify pulling in pg_trgm.
CREATE INDEX IF NOT EXISTS cvm_fund_registry_search_name_idx
  ON public.cvm_fund_registry (search_name);
