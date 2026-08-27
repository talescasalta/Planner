-- Investments module: patrimony tracking sourced from B3 "Área do Investidor"
-- xlsx exports (posição, negociação, movimentação).
--
-- B3 offers no API for individuals, so the app ingests the official exports.
-- Position uploads become immutable per-date snapshots (each upload is a point
-- on the patrimony curve and a reconciliation baseline); trades and movements
-- become a unified event stream from which current quantities are derived
-- between snapshots; quotes fetched by a cron keep valuations fresh without
-- monthly position uploads. Assets are per owner because capital-gains tax
-- (IR) is assessed per CPF, not per household.

-- ============================================================
-- investment_assets
-- ============================================================

CREATE TABLE IF NOT EXISTS public.investment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_class text NOT NULL CHECK (asset_class IN
    ('etf', 'fii', 'acao', 'fundo', 'tesouro', 'cdb', 'lca_lci', 'outro')),
  ticker text,
  name text NOT NULL,
  product_key text NOT NULL,
  issuer text,
  tax_bucket text NOT NULL CHECK (tax_bucket IN
    ('fii', 'acoes', 'etf_rv', 'retido_fonte', 'isento')),
  override_quantity numeric,
  override_total_cost numeric,
  override_date date,
  created_at timestamptz DEFAULT now(),
  UNIQUE (household_id, owner_user_id, product_key)
);

COMMENT ON TABLE public.investment_assets IS
  'One row per (owner, asset). product_key is the normalized match key parsed from B3 Produto strings (ticker, CDB:<code>, TESOURO:<name>).';
COMMENT ON COLUMN public.investment_assets.tax_bucket IS
  'Which IR apuração bucket sales fall into. retido_fonte and isento are informative only (no DARF).';
COMMENT ON COLUMN public.investment_assets.override_total_cost IS
  'Manual initial cost basis for holdings bought before the available B3 history, paired with override_quantity/override_date. Seeds the weighted-average cost.';

ALTER TABLE public.investment_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investment_assets_select" ON public.investment_assets;
CREATE POLICY "investment_assets_select"
  ON public.investment_assets
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_assets_insert" ON public.investment_assets;
CREATE POLICY "investment_assets_insert"
  ON public.investment_assets
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_assets_update" ON public.investment_assets;
CREATE POLICY "investment_assets_update"
  ON public.investment_assets
  FOR UPDATE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_assets_delete" ON public.investment_assets;
CREATE POLICY "investment_assets_delete"
  ON public.investment_assets
  FOR DELETE
  USING (private.is_member_of_household(household_id));

-- ============================================================
-- investment_snapshots
-- ============================================================

CREATE TABLE IF NOT EXISTS public.investment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.investment_assets(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  institution text,
  quantity numeric NOT NULL,
  close_price numeric,
  gross_value numeric,
  net_value numeric NOT NULL,
  applied_value numeric,
  import_id uuid REFERENCES public.transaction_imports(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (household_id, asset_id, snapshot_date)
);

COMMENT ON TABLE public.investment_snapshots IS
  'Immutable official position per asset per date, from B3 posição exports. Latest snapshot is the baseline quantity from which events derive the current position. The UNIQUE key makes re-uploads idempotent.';
COMMENT ON COLUMN public.investment_snapshots.close_price IS
  'Null for renda fixa rows where B3 prints "-" instead of a price.';

ALTER TABLE public.investment_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investment_snapshots_select" ON public.investment_snapshots;
CREATE POLICY "investment_snapshots_select"
  ON public.investment_snapshots
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_snapshots_insert" ON public.investment_snapshots;
CREATE POLICY "investment_snapshots_insert"
  ON public.investment_snapshots
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_snapshots_update" ON public.investment_snapshots;
CREATE POLICY "investment_snapshots_update"
  ON public.investment_snapshots
  FOR UPDATE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_snapshots_delete" ON public.investment_snapshots;
CREATE POLICY "investment_snapshots_delete"
  ON public.investment_snapshots
  FOR DELETE
  USING (private.is_member_of_household(household_id));

CREATE INDEX IF NOT EXISTS investment_snapshots_household_snapshot_date_idx
  ON public.investment_snapshots (household_id, snapshot_date);

-- ============================================================
-- investment_events
-- ============================================================

CREATE TABLE IF NOT EXISTS public.investment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.investment_assets(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  event_type text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  quantity numeric,
  unit_price numeric,
  total_value numeric,
  institution text,
  raw_product text NOT NULL,
  source text NOT NULL CHECK (source IN
    ('b3_movimentacao', 'b3_negociacao', 'manual')),
  dedup_key text NOT NULL,
  import_id uuid REFERENCES public.transaction_imports(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (household_id, dedup_key)
);

COMMENT ON TABLE public.investment_events IS
  'Unified stream of B3 negociação (trades) and movimentação (settlements, income, corporate actions). Quantities derive only from movimentação events; the tax engine prefers negociação rows for trade lots. Both files can describe the same trade, so consumers must not sum across sources.';
COMMENT ON COLUMN public.investment_events.dedup_key IS
  'source|date|type|normalized product|qty|total|occurrence-index. The occurrence index keeps legitimately identical rows within one file while making re-uploads and overlapping date ranges idempotent.';

ALTER TABLE public.investment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investment_events_select" ON public.investment_events;
CREATE POLICY "investment_events_select"
  ON public.investment_events
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_events_insert" ON public.investment_events;
CREATE POLICY "investment_events_insert"
  ON public.investment_events
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_events_update" ON public.investment_events;
CREATE POLICY "investment_events_update"
  ON public.investment_events
  FOR UPDATE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_events_delete" ON public.investment_events;
CREATE POLICY "investment_events_delete"
  ON public.investment_events
  FOR DELETE
  USING (private.is_member_of_household(household_id));

CREATE INDEX IF NOT EXISTS investment_events_household_asset_event_date_idx
  ON public.investment_events (household_id, asset_id, event_date);

-- ============================================================
-- investment_quotes
-- ============================================================

CREATE TABLE IF NOT EXISTS public.investment_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES public.investment_assets(id) ON DELETE CASCADE,
  quote_date date NOT NULL,
  price numeric NOT NULL,
  source text NOT NULL CHECK (source IN
    ('brapi', 'tesouro_transparente', 'snapshot', 'manual')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (asset_id, quote_date)
);

COMMENT ON TABLE public.investment_quotes IS
  'Daily prices per asset. Filled by the quotes cron (brapi for tickers, Tesouro Transparente for Tesouro Direto) and by posição imports (source=snapshot). Renda fixa bancária has no public price: valuation falls back to the last known value.';

ALTER TABLE public.investment_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investment_quotes_select" ON public.investment_quotes;
CREATE POLICY "investment_quotes_select"
  ON public.investment_quotes
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_quotes_insert" ON public.investment_quotes;
CREATE POLICY "investment_quotes_insert"
  ON public.investment_quotes
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_quotes_update" ON public.investment_quotes;
CREATE POLICY "investment_quotes_update"
  ON public.investment_quotes
  FOR UPDATE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_quotes_delete" ON public.investment_quotes;
CREATE POLICY "investment_quotes_delete"
  ON public.investment_quotes
  FOR DELETE
  USING (private.is_member_of_household(household_id));

CREATE INDEX IF NOT EXISTS investment_quotes_asset_quote_date_idx
  ON public.investment_quotes (asset_id, quote_date DESC);

-- ============================================================
-- investment_darf_status
-- ============================================================

CREATE TABLE IF NOT EXISTS public.investment_darf_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reference_month date NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  paid_at date,
  amount_paid numeric,
  notes text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (household_id, owner_user_id, reference_month)
);

COMMENT ON TABLE public.investment_darf_status IS
  'The only persisted tax state: whether the human paid the DARF of a given month. Everything else (gains, carryforward, due amounts) is derived from investment_events on the fly, per owner because IR is assessed per CPF.';
COMMENT ON COLUMN public.investment_darf_status.reference_month IS
  'First day of the apuração month (the month sales happened, not the payment month).';

ALTER TABLE public.investment_darf_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investment_darf_status_select" ON public.investment_darf_status;
CREATE POLICY "investment_darf_status_select"
  ON public.investment_darf_status
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_darf_status_insert" ON public.investment_darf_status;
CREATE POLICY "investment_darf_status_insert"
  ON public.investment_darf_status
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_darf_status_update" ON public.investment_darf_status;
CREATE POLICY "investment_darf_status_update"
  ON public.investment_darf_status
  FOR UPDATE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "investment_darf_status_delete" ON public.investment_darf_status;
CREATE POLICY "investment_darf_status_delete"
  ON public.investment_darf_status
  FOR DELETE
  USING (private.is_member_of_household(household_id));

-- ============================================================
-- transaction_imports: accept the three B3 export types as batches
-- ============================================================

ALTER TABLE public.transaction_imports
  DROP CONSTRAINT IF EXISTS transaction_imports_source_type_check;
ALTER TABLE public.transaction_imports
  ADD CONSTRAINT transaction_imports_source_type_check
  CHECK (source_type IS NULL OR source_type IN
    ('credit_card', 'bank_account', 'vale_alimentacao', 'vale_refeicao',
     'b3_posicao', 'b3_negociacao', 'b3_movimentacao'));
