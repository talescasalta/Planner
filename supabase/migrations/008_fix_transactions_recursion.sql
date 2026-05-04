-- Migration 008: Fix infinite recursion between transactions and transaction_access
-- transactions policies query transaction_access, transaction_access policies
-- query transactions — both with RLS enabled, causing recursion.
-- Fix: wrap the joins in SECURITY DEFINER helper functions.

-- ============================================
-- Helper functions
-- ============================================

CREATE OR REPLACE FUNCTION public.user_can_read_transaction(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.transaction_access ta
    WHERE ta.transaction_id = p_transaction_id
      AND ta.user_id = auth.uid()
      AND ta.can_read = true
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_edit_transaction(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.transaction_access ta
    WHERE ta.transaction_id = p_transaction_id
      AND ta.user_id = auth.uid()
      AND ta.can_edit = true
  );
$$;

CREATE OR REPLACE FUNCTION public.transaction_in_user_household(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.transactions t
    JOIN public.household_members hm
      ON hm.household_id = t.household_id
    WHERE t.id = p_transaction_id
      AND hm.user_id = auth.uid()
  );
$$;

-- ============================================
-- Rewrite transactions policies to use helpers
-- ============================================

DROP POLICY IF EXISTS "transactions_select_with_access" ON public.transactions;
DROP POLICY IF EXISTS "transactions_update_with_edit" ON public.transactions;
DROP POLICY IF EXISTS "transactions_delete_with_edit" ON public.transactions;
DROP POLICY IF EXISTS "transactions_insert_members" ON public.transactions;

CREATE POLICY "transactions_select_with_access"
  ON public.transactions
  FOR SELECT
  USING (public.user_can_read_transaction(id));

CREATE POLICY "transactions_update_with_edit"
  ON public.transactions
  FOR UPDATE
  USING (public.user_can_edit_transaction(id));

CREATE POLICY "transactions_delete_with_edit"
  ON public.transactions
  FOR DELETE
  USING (public.user_can_edit_transaction(id));

CREATE POLICY "transactions_insert_members"
  ON public.transactions
  FOR INSERT
  WITH CHECK (public.is_member_of_household(household_id));

-- ============================================
-- Rewrite transaction_access policies to use helpers
-- ============================================

DROP POLICY IF EXISTS "transaction_access_select" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_insert" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_update" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_delete" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_select_members" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_insert_members" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_update_members" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_delete_members" ON public.transaction_access;

CREATE POLICY "transaction_access_select"
  ON public.transaction_access
  FOR SELECT
  USING (public.transaction_in_user_household(transaction_id));

CREATE POLICY "transaction_access_insert"
  ON public.transaction_access
  FOR INSERT
  WITH CHECK (public.transaction_in_user_household(transaction_id));

CREATE POLICY "transaction_access_update"
  ON public.transaction_access
  FOR UPDATE
  USING (public.transaction_in_user_household(transaction_id));

CREATE POLICY "transaction_access_delete"
  ON public.transaction_access
  FOR DELETE
  USING (public.transaction_in_user_household(transaction_id));
