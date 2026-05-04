-- Migration 011: Move RLS helper functions out of the exposed public schema
-- and restrict public SECURITY DEFINER functions from direct RPC execution.

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.is_member_of_household(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id
      AND user_id = (select auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.is_admin_of_household(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id
      AND user_id = (select auth.uid())
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION private.household_has_members(p_household_id uuid)
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

CREATE OR REPLACE FUNCTION private.user_can_read_transaction(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.transaction_access ta
    WHERE ta.transaction_id = p_transaction_id
      AND ta.user_id = (select auth.uid())
      AND ta.can_read = true
  );
$$;

CREATE OR REPLACE FUNCTION private.user_can_edit_transaction(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.transaction_access ta
    WHERE ta.transaction_id = p_transaction_id
      AND ta.user_id = (select auth.uid())
      AND ta.can_edit = true
  );
$$;

CREATE OR REPLACE FUNCTION private.transaction_in_user_household(p_transaction_id uuid)
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
      AND hm.user_id = (select auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.transaction_household_id(p_transaction_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT household_id
  FROM public.transactions
  WHERE id = p_transaction_id;
$$;

CREATE OR REPLACE FUNCTION private.user_belongs_to_transaction_household(
  p_transaction_id uuid,
  p_user_id uuid
)
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
      AND hm.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION private.user_can_manage_transaction_access(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.user_can_edit_transaction(p_transaction_id)
    OR private.is_admin_of_household(private.transaction_household_id(p_transaction_id));
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO anon, authenticated;

DROP POLICY IF EXISTS "households_select" ON public.households;
CREATE POLICY "households_select"
  ON public.households
  FOR SELECT
  USING (private.is_member_of_household(id));

DROP POLICY IF EXISTS "profiles_select_household" ON public.profiles;
CREATE POLICY "profiles_select_household"
  ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = profiles.user_id
        AND private.is_member_of_household(hm.household_id)
    )
  );

DROP POLICY IF EXISTS "household_members_select" ON public.household_members;
CREATE POLICY "household_members_select"
  ON public.household_members
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "household_members_insert_first_member" ON public.household_members;
DROP POLICY IF EXISTS "household_members_insert_existing_admin" ON public.household_members;
CREATE POLICY "household_members_insert"
  ON public.household_members
  FOR INSERT
  WITH CHECK (
    (
      user_id = (select auth.uid())
      AND NOT private.household_has_members(household_id)
    )
    OR private.is_admin_of_household(household_id)
  );

DROP POLICY IF EXISTS "household_members_delete_admin" ON public.household_members;
CREATE POLICY "household_members_delete_admin"
  ON public.household_members
  FOR DELETE
  USING (private.is_admin_of_household(household_id));

DROP POLICY IF EXISTS "financial_profiles_select" ON public.financial_profiles;
CREATE POLICY "financial_profiles_select"
  ON public.financial_profiles
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "financial_profiles_insert" ON public.financial_profiles;
CREATE POLICY "financial_profiles_insert"
  ON public.financial_profiles
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "financial_profiles_update" ON public.financial_profiles;
CREATE POLICY "financial_profiles_update"
  ON public.financial_profiles
  FOR UPDATE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "financial_profiles_delete" ON public.financial_profiles;
CREATE POLICY "financial_profiles_delete"
  ON public.financial_profiles
  FOR DELETE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "categories_select" ON public.categories;
CREATE POLICY "categories_select"
  ON public.categories
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "categories_insert" ON public.categories;
CREATE POLICY "categories_insert"
  ON public.categories
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "categories_update" ON public.categories;
CREATE POLICY "categories_update"
  ON public.categories
  FOR UPDATE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "categories_delete" ON public.categories;
CREATE POLICY "categories_delete"
  ON public.categories
  FOR DELETE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_rules_select" ON public.classification_rules;
CREATE POLICY "classification_rules_select"
  ON public.classification_rules
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_rules_insert" ON public.classification_rules;
CREATE POLICY "classification_rules_insert"
  ON public.classification_rules
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_rules_update" ON public.classification_rules;
CREATE POLICY "classification_rules_update"
  ON public.classification_rules
  FOR UPDATE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_rules_delete" ON public.classification_rules;
CREATE POLICY "classification_rules_delete"
  ON public.classification_rules
  FOR DELETE
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "transaction_imports_select" ON public.transaction_imports;
CREATE POLICY "transaction_imports_select"
  ON public.transaction_imports
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "transaction_imports_insert" ON public.transaction_imports;
CREATE POLICY "transaction_imports_insert"
  ON public.transaction_imports
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_jobs_select" ON public.classification_jobs;
CREATE POLICY "classification_jobs_select"
  ON public.classification_jobs
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "classification_jobs_insert" ON public.classification_jobs;
CREATE POLICY "classification_jobs_insert"
  ON public.classification_jobs
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "audit_events_select" ON public.audit_events;
CREATE POLICY "audit_events_select"
  ON public.audit_events
  FOR SELECT
  USING (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "audit_events_insert" ON public.audit_events;
CREATE POLICY "audit_events_insert"
  ON public.audit_events
  FOR INSERT
  WITH CHECK (private.is_member_of_household(household_id));

DROP POLICY IF EXISTS "transactions_select_with_access" ON public.transactions;
CREATE POLICY "transactions_select_with_access"
  ON public.transactions
  FOR SELECT
  USING (private.user_can_read_transaction(id));

DROP POLICY IF EXISTS "transactions_update_with_edit" ON public.transactions;
CREATE POLICY "transactions_update_with_edit"
  ON public.transactions
  FOR UPDATE
  USING (private.user_can_edit_transaction(id));

DROP POLICY IF EXISTS "transactions_delete_with_edit" ON public.transactions;
CREATE POLICY "transactions_delete_with_edit"
  ON public.transactions
  FOR DELETE
  USING (private.user_can_edit_transaction(id));

DROP POLICY IF EXISTS "transactions_insert_members" ON public.transactions;
CREATE POLICY "transactions_insert_members"
  ON public.transactions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = transactions.household_id
        AND hm.user_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "transaction_access_select" ON public.transaction_access;
CREATE POLICY "transaction_access_select"
  ON public.transaction_access
  FOR SELECT
  USING (private.transaction_in_user_household(transaction_id));

DROP POLICY IF EXISTS "transaction_access_insert" ON public.transaction_access;
CREATE POLICY "transaction_access_insert"
  ON public.transaction_access
  FOR INSERT
  WITH CHECK (
    private.user_can_manage_transaction_access(transaction_id)
    AND private.user_belongs_to_transaction_household(transaction_id, user_id)
  );

DROP POLICY IF EXISTS "transaction_access_update" ON public.transaction_access;
CREATE POLICY "transaction_access_update"
  ON public.transaction_access
  FOR UPDATE
  USING (private.user_can_manage_transaction_access(transaction_id))
  WITH CHECK (
    private.user_can_manage_transaction_access(transaction_id)
    AND private.user_belongs_to_transaction_household(transaction_id, user_id)
  );

DROP POLICY IF EXISTS "transaction_access_delete" ON public.transaction_access;
CREATE POLICY "transaction_access_delete"
  ON public.transaction_access
  FOR DELETE
  USING (private.user_can_manage_transaction_access(transaction_id));

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.seed_default_categories(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_default_financial_profiles(uuid) TO service_role;

DROP FUNCTION IF EXISTS public.create_household(text, uuid);
DROP FUNCTION IF EXISTS public.add_household_member(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.remove_household_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_user_household_id(uuid);
DROP FUNCTION IF EXISTS public.is_member_of_household(uuid);
DROP FUNCTION IF EXISTS public.household_has_members(uuid);
DROP FUNCTION IF EXISTS public.user_can_read_transaction(uuid);
DROP FUNCTION IF EXISTS public.user_can_edit_transaction(uuid);
DROP FUNCTION IF EXISTS public.transaction_in_user_household(uuid);
DROP FUNCTION IF EXISTS public.is_admin_of_household(uuid);
DROP FUNCTION IF EXISTS public.transaction_household_id(uuid);
DROP FUNCTION IF EXISTS public.user_belongs_to_transaction_household(uuid, uuid);
DROP FUNCTION IF EXISTS public.user_can_manage_transaction_access(uuid);
