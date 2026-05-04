-- Migration 001_initial_schema
-- Private Couple Expense Classifier

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- 1. Create ALL tables first (no policies, no RLS yet)
-- ============================================

CREATE TABLE public.households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Casa',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id)
);

CREATE TABLE public.household_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE TABLE public.financial_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('individual', 'shared')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name text NOT NULL,
  parent_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  date date NOT NULL,
  description text NOT NULL,
  clean_description text,
  merchant text,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  source_name text,
  paid_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_profile_id uuid REFERENCES public.financial_profiles(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  subcategory_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  classification_method text NOT NULL DEFAULT 'unknown',
  classification_confidence numeric,
  review_status text NOT NULL DEFAULT 'needs_review',
  classification_suggestion jsonb,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.transaction_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  can_read boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE (transaction_id, user_id)
);

CREATE TABLE public.classification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  pattern text NOT NULL,
  pattern_type text NOT NULL CHECK (pattern_type IN ('merchant_contains', 'description_contains', 'exact_merchant', 'regex')),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  owner_profile_id uuid REFERENCES public.financial_profiles(id) ON DELETE SET NULL,
  confidence numeric NOT NULL DEFAULT 1.0,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.transaction_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded',
  row_count integer,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.classification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  model text,
  input_count integer,
  success_count integer,
  failed_count integer,
  created_at timestamptz DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- 2. Enable RLS on all tables
-- ============================================

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. Create ALL policies (tables exist now)
-- ============================================

-- households
CREATE POLICY "households_select_members"
  ON public.households
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = households.id AND hm.user_id = auth.uid()
    )
  );

-- profiles
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "profiles_select_household"
  ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm1
      JOIN public.household_members hm2 ON hm1.household_id = hm2.household_id
      WHERE hm1.user_id = auth.uid() AND hm2.user_id = profiles.user_id
    )
  );

-- household_members
CREATE POLICY "household_members_select_same_household"
  ON public.household_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = household_members.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "household_members_insert_admin"
  ON public.household_members
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = household_members.household_id AND hm.user_id = auth.uid()
    )
  );

-- financial_profiles
CREATE POLICY "financial_profiles_select_members"
  ON public.financial_profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = financial_profiles.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "financial_profiles_insert_members"
  ON public.financial_profiles
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = financial_profiles.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "financial_profiles_update_members"
  ON public.financial_profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = financial_profiles.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "financial_profiles_delete_members"
  ON public.financial_profiles
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = financial_profiles.household_id AND hm.user_id = auth.uid()
    )
  );

-- categories
CREATE POLICY "categories_select_members"
  ON public.categories
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = categories.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "categories_insert_members"
  ON public.categories
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = categories.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "categories_update_members"
  ON public.categories
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = categories.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "categories_delete_members"
  ON public.categories
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = categories.household_id AND hm.user_id = auth.uid()
    )
  );

-- transactions
CREATE POLICY "transactions_select_with_access"
  ON public.transactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.transaction_access ta
      WHERE ta.transaction_id = transactions.id AND ta.user_id = auth.uid() AND ta.can_read = true
    )
  );

CREATE POLICY "transactions_insert_members"
  ON public.transactions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = transactions.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "transactions_update_with_edit"
  ON public.transactions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.transaction_access ta
      WHERE ta.transaction_id = transactions.id AND ta.user_id = auth.uid() AND ta.can_edit = true
    )
  );

CREATE POLICY "transactions_delete_with_edit"
  ON public.transactions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.transaction_access ta
      WHERE ta.transaction_id = transactions.id AND ta.user_id = auth.uid() AND ta.can_edit = true
    )
  );

-- transaction_access
CREATE POLICY "transaction_access_select_members"
  ON public.transaction_access
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      JOIN public.household_members hm ON t.household_id = hm.household_id
      WHERE t.id = transaction_access.transaction_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "transaction_access_insert_members"
  ON public.transaction_access
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.transactions t
      JOIN public.household_members hm ON t.household_id = hm.household_id
      WHERE t.id = transaction_access.transaction_id AND hm.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.household_members hm
      JOIN public.transactions t ON t.household_id = hm.household_id
      WHERE t.id = transaction_access.transaction_id AND hm.user_id = transaction_access.user_id
    )
  );

CREATE POLICY "transaction_access_update_members"
  ON public.transaction_access
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      JOIN public.household_members hm ON t.household_id = hm.household_id
      WHERE t.id = transaction_access.transaction_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "transaction_access_delete_members"
  ON public.transaction_access
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      JOIN public.household_members hm ON t.household_id = hm.household_id
      WHERE t.id = transaction_access.transaction_id AND hm.user_id = auth.uid()
    )
  );

-- classification_rules
CREATE POLICY "classification_rules_select_members"
  ON public.classification_rules
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = classification_rules.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "classification_rules_insert_members"
  ON public.classification_rules
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = classification_rules.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "classification_rules_update_members"
  ON public.classification_rules
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = classification_rules.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "classification_rules_delete_members"
  ON public.classification_rules
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = classification_rules.household_id AND hm.user_id = auth.uid()
    )
  );

-- transaction_imports
CREATE POLICY "transaction_imports_select_members"
  ON public.transaction_imports
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = transaction_imports.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "transaction_imports_insert_members"
  ON public.transaction_imports
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = transaction_imports.household_id AND hm.user_id = auth.uid()
    )
  );

-- classification_jobs
CREATE POLICY "classification_jobs_select_members"
  ON public.classification_jobs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = classification_jobs.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "classification_jobs_insert_members"
  ON public.classification_jobs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = classification_jobs.household_id AND hm.user_id = auth.uid()
    )
  );

-- audit_events
CREATE POLICY "audit_events_select_members"
  ON public.audit_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = audit_events.household_id AND hm.user_id = auth.uid()
    )
  );

CREATE POLICY "audit_events_insert_members"
  ON public.audit_events
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = audit_events.household_id AND hm.user_id = auth.uid()
    )
  );

-- ============================================
-- 4. Triggers (depend on tables)
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'display_name', new.email));
  RETURN new;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 5. Helper functions (depend on tables)
-- ============================================

CREATE OR REPLACE FUNCTION public.get_user_household_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT household_id FROM public.household_members WHERE user_id = p_user_id LIMIT 1;
$$;

-- Function to seed default categories for a household
CREATE OR REPLACE FUNCTION public.seed_default_categories(p_household_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.categories (household_id, name)
  VALUES
    (p_household_id, 'Moradia'),
    (p_household_id, 'Mercado'),
    (p_household_id, 'Restaurante / Delivery'),
    (p_household_id, 'Transporte'),
    (p_household_id, 'Saúde / Farmácia'),
    (p_household_id, 'Gestação / Bebê'),
    (p_household_id, 'Educação'),
    (p_household_id, 'Lazer'),
    (p_household_id, 'Assinaturas'),
    (p_household_id, 'Compras pessoais'),
    (p_household_id, 'Pets'),
    (p_household_id, 'Impostos / Taxas'),
    (p_household_id, 'Outros');
$$;

-- Function to seed default financial profiles for a household
CREATE OR REPLACE FUNCTION public.seed_default_financial_profiles(p_household_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.financial_profiles (household_id, name, type)
  VALUES
    (p_household_id, 'Pessoa A', 'individual'),
    (p_household_id, 'Pessoa B', 'individual'),
    (p_household_id, 'Casal', 'shared');
$$;
