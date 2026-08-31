-- Open-ended investment funds and previdência plans.
--
-- These never reach B3 custody, so no import file mentions them: they are
-- registered by hand. Their daily quota, however, is public — CVM publishes an
-- informe diário for every registered fund — so once the CNPJ is known the
-- valuation keeps itself current like any listed asset.
--
-- Matching needs the subclass too. Post-RCVM 175 a single CNPJ can carry
-- several subclasses whose quotas differ by a factor of three (Kinea Atlas II
-- trades at 2.97 in subclass I and 1.04 in subclass IV), so the subclass id is
-- part of the identity, not a detail.

ALTER TABLE public.investment_assets
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS cvm_subclass_id text;

COMMENT ON COLUMN public.investment_assets.cnpj IS
  'Fund CNPJ, digits only, used to match the CVM informe diário. Null for listed assets, which are matched by ticker.';
COMMENT ON COLUMN public.investment_assets.cvm_subclass_id IS
  'CVM ID_SUBCLASSE when the fund splits into subclasses with distinct quotas. Empty string means the fund reports a single quota.';

CREATE INDEX IF NOT EXISTS investment_assets_cnpj_idx
  ON public.investment_assets (cnpj)
  WHERE cnpj IS NOT NULL;

-- Previdência (PGBL/VGBL) sits in its own class: the money is real patrimony,
-- but the tax is withheld by the insurer under the regressive table, so it
-- never produces a DARF here.
ALTER TABLE public.investment_assets
  DROP CONSTRAINT IF EXISTS investment_assets_asset_class_check;
ALTER TABLE public.investment_assets
  ADD CONSTRAINT investment_assets_asset_class_check
  CHECK (asset_class IN
    ('etf', 'fii', 'acao', 'fundo', 'previdencia', 'tesouro', 'cdb', 'lca_lci', 'outro'));

ALTER TABLE public.investment_quotes
  DROP CONSTRAINT IF EXISTS investment_quotes_source_check;
ALTER TABLE public.investment_quotes
  ADD CONSTRAINT investment_quotes_source_check
  CHECK (source IN ('yahoo', 'tesouro_transparente', 'cvm', 'snapshot', 'manual'));
