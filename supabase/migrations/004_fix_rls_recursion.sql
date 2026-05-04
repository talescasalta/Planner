-- Migration 004: Fix infinite recursion in RLS policies
-- All policies that query household_members from within policies on tables
-- that household_members also queries create infinite recursion.
-- Solution: use SECURITY DEFINER helper functions that bypass RLS.

-- ============================================
-- Helper functions (SECURITY DEFINER = bypasses RLS)
-- ============================================

CREATE OR REPLACE FUNCTION public.is_member_of_household(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.household_has_members(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id
  );
$$;

-- ============================================
-- Fix households policies
-- ============================================

DROP POLICY IF EXISTS "households_select_members" ON public.households;
CREATE POLICY "households_select"
  ON public.households
  FOR SELECT
  USING (public.is_member_of_household(id));

-- ============================================
-- Fix profiles policies
-- ============================================

DROP POLICY IF EXISTS "profiles_select_household" ON public.profiles;
CREATE POLICY "profiles_select_household"
  ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = profiles.user_id
        AND public.is_member_of_household(hm.household_id)
    )
  );

-- ============================================
-- Fix household_members policies
-- ============================================

DROP POLICY IF EXISTS "household_members_select_same_household" ON public.household_members;
DROP POLICY IF EXISTS "household_members_insert_admin" ON public.household_members;
DROP POLICY IF EXISTS "household_members_insert_first_member" ON public.household_members;
DROP POLICY IF EXISTS "household_members_insert_existing_member" ON public.household_members;
DROP POLICY IF EXISTS "household_members_delete_members" ON public.household_members;
DROP POLICY IF EXISTS "household_members_delete" ON public.household_members;

CREATE POLICY "household_members_select"
  ON public.household_members
  FOR SELECT
  USING (public.is_member_of_household(household_id));

CREATE POLICY "household_members_insert_first_member"
  ON public.household_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT public.household_has_members(household_id)
  );

CREATE POLICY "household_members_insert_existing_member"
  ON public.household_members
  FOR INSERT
  WITH CHECK (public.is_member_of_household(household_id));

CREATE POLICY "household_members_delete"
  ON public.household_members
  FOR DELETE
  USING (public.is_member_of_household(household_id));

-- ============================================
-- Fix financial_profiles policies
-- ============================================

DROP POLICY IF EXISTS "financial_profiles_select_members" ON public.financial_profiles;
CREATE POLICY "financial_profiles_select"
  ON public.financial_profiles
  FOR SELECT
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "financial_profiles_insert_members" ON public.financial_profiles;
CREATE POLICY "financial_profiles_insert"
  ON public.financial_profiles
  FOR INSERT
  WITH CHECK (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "financial_profiles_update_members" ON public.financial_profiles;
CREATE POLICY "financial_profiles_update"
  ON public.financial_profiles
  FOR UPDATE
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "financial_profiles_delete_members" ON public.financial_profiles;
CREATE POLICY "financial_profiles_delete"
  ON public.financial_profiles
  FOR DELETE
  USING (public.is_member_of_household(household_id));

-- ============================================
-- Fix categories policies
-- ============================================

DROP POLICY IF EXISTS "categories_select_members" ON public.categories;
CREATE POLICY "categories_select"
  ON public.categories
  FOR SELECT
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "categories_insert_members" ON public.categories;
CREATE POLICY "categories_insert"
  ON public.categories
  FOR INSERT
  WITH CHECK (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "categories_update_members" ON public.categories;
CREATE POLICY "categories_update"
  ON public.categories
  FOR UPDATE
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "categories_delete_members" ON public.categories;
CREATE POLICY "categories_delete"
  ON public.categories
  FOR DELETE
  USING (public.is_member_of_household(household_id));

-- ============================================
-- Fix classification_rules policies
-- ============================================

DROP POLICY IF EXISTS "classification_rules_select_members" ON public.classification_rules;
CREATE POLICY "classification_rules_select"
  ON public.classification_rules
  FOR SELECT
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_rules_insert_members" ON public.classification_rules;
CREATE POLICY "classification_rules_insert"
  ON public.classification_rules
  FOR INSERT
  WITH CHECK (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_rules_update_members" ON public.classification_rules;
CREATE POLICY "classification_rules_update"
  ON public.classification_rules
  FOR UPDATE
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_rules_delete_members" ON public.classification_rules;
CREATE POLICY "classification_rules_delete"
  ON public.classification_rules
  FOR DELETE
  USING (public.is_member_of_household(household_id));

-- ============================================
-- Fix transaction_imports policies
-- ============================================

DROP POLICY IF EXISTS "transaction_imports_select_members" ON public.transaction_imports;
CREATE POLICY "transaction_imports_select"
  ON public.transaction_imports
  FOR SELECT
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "transaction_imports_insert_members" ON public.transaction_imports;
CREATE POLICY "transaction_imports_insert"
  ON public.transaction_imports
  FOR INSERT
  WITH CHECK (public.is_member_of_household(household_id));

-- ============================================
-- Fix classification_jobs policies
-- ============================================

DROP POLICY IF EXISTS "classification_jobs_select_members" ON public.classification_jobs;
CREATE POLICY "classification_jobs_select"
  ON public.classification_jobs
  FOR SELECT
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_jobs_insert_members" ON public.classification_jobs;
CREATE POLICY "classification_jobs_insert"
  ON public.classification_jobs
  FOR INSERT
  WITH CHECK (public.is_member_of_household(household_id));

-- ============================================
-- Fix audit_events policies
-- ============================================

DROP POLICY IF EXISTS "audit_events_select_members" ON public.audit_events;
CREATE POLICY "audit_events_select"
  ON public.audit_events
  FOR SELECT
  USING (public.is_member_of_household(household_id));

DROP POLICY IF EXISTS "audit_events_insert_members" ON public.audit_events;
CREATE POLICY "audit_events_insert"
  ON public.audit_events
  FOR INSERT
  WITH CHECK (public.is_member_of_household(household_id));

-- ============================================
-- Fix transaction_access policies
-- ============================================

DROP POLICY IF EXISTS "transaction_access_select_members" ON public.transaction_access;
CREATE POLICY "transaction_access_select"
  ON public.transaction_access
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_access.transaction_id
        AND public.is_member_of_household(t.household_id)
    )
  );

DROP POLICY IF EXISTS "transaction_access_insert_members" ON public.transaction_access;
CREATE POLICY "transaction_access_insert"
  ON public.transaction_access
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_access.transaction_id
        AND public.is_member_of_household(t.household_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_access.transaction_id
        AND public.is_member_of_household(t.household_id)
    )
  );

DROP POLICY IF EXISTS "transaction_access_update_members" ON public.transaction_access;
CREATE POLICY "transaction_access_update"
  ON public.transaction_access
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_access.transaction_id
        AND public.is_member_of_household(t.household_id)
    )
  );

DROP POLICY IF EXISTS "transaction_access_delete_members" ON public.transaction_access;
CREATE POLICY "transaction_access_delete"
  ON public.transaction_access
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id = transaction_access.transaction_id
        AND public.is_member_of_household(t.household_id)
    )
  );
