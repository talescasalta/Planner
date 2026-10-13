-- Performance: RLS membership checks evaluated once per query, not per row,
-- plus indexes for the filters and cascades the app actually runs.
--
-- Policies called private.is_member_of_household(household_id) (and, on
-- transactions, private.user_can_read/edit_transaction(id)) for every row.
-- SECURITY DEFINER functions are never inlined, so a query returning 25k
-- investment quotes made 25k function calls: ~315 ms locally, against ~14 ms
-- when the same check is written as `household_id IN (SELECT ...)`, which
-- Postgres runs once and hashes.
--
-- The rewrite keeps every policy's meaning: `x IN (SELECT ids)` is true in
-- exactly the rows where the old EXISTS helper was true, and NULL (rejected)
-- where it was false for a NULL key. Names, commands and the non-membership
-- parts of each expression are unchanged; the pgTAP suite covers them.

CREATE OR REPLACE FUNCTION private.user_household_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT household_id FROM public.household_members
  WHERE user_id = (select auth.uid());
$$;

CREATE OR REPLACE FUNCTION private.user_readable_transaction_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT transaction_id FROM public.transaction_access
  WHERE user_id = (select auth.uid()) AND can_read = true;
$$;

CREATE OR REPLACE FUNCTION private.user_editable_transaction_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT transaction_id FROM public.transaction_access
  WHERE user_id = (select auth.uid()) AND can_edit = true;
$$;

REVOKE EXECUTE ON FUNCTION private.user_household_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.user_readable_transaction_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.user_editable_transaction_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_household_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.user_readable_transaction_ids() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.user_editable_transaction_ids() TO anon, authenticated;

-- households / members / profiles
ALTER POLICY "households_select" ON public.households
  USING (id IN (SELECT private.user_household_ids()));
ALTER POLICY "household_members_select" ON public.household_members
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "profiles_select_household" ON public.profiles
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.user_id = profiles.user_id
        AND hm.household_id IN (SELECT private.user_household_ids())
    )
  );

-- Tables whose every policy is plain household membership.
ALTER POLICY "financial_profiles_select" ON public.financial_profiles
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "financial_profiles_insert" ON public.financial_profiles
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "financial_profiles_update" ON public.financial_profiles
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "financial_profiles_delete" ON public.financial_profiles
  USING (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "classification_rules_select" ON public.classification_rules
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "classification_rules_insert" ON public.classification_rules
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "classification_rules_update" ON public.classification_rules
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "classification_rules_delete" ON public.classification_rules
  USING (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "transaction_imports_select" ON public.transaction_imports
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "transaction_imports_insert" ON public.transaction_imports
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "classification_jobs_select" ON public.classification_jobs
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "classification_jobs_insert" ON public.classification_jobs
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "audit_events_select" ON public.audit_events
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "audit_events_insert" ON public.audit_events
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "investment_assets_select" ON public.investment_assets
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_assets_insert" ON public.investment_assets
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_assets_update" ON public.investment_assets
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_assets_delete" ON public.investment_assets
  USING (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "investment_snapshots_select" ON public.investment_snapshots
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_snapshots_insert" ON public.investment_snapshots
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_snapshots_update" ON public.investment_snapshots
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_snapshots_delete" ON public.investment_snapshots
  USING (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "investment_events_select" ON public.investment_events
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_events_insert" ON public.investment_events
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_events_update" ON public.investment_events
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_events_delete" ON public.investment_events
  USING (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "investment_quotes_select" ON public.investment_quotes
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_quotes_insert" ON public.investment_quotes
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_quotes_update" ON public.investment_quotes
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_quotes_delete" ON public.investment_quotes
  USING (household_id IN (SELECT private.user_household_ids()));

ALTER POLICY "investment_darf_status_select" ON public.investment_darf_status
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_darf_status_insert" ON public.investment_darf_status
  WITH CHECK (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_darf_status_update" ON public.investment_darf_status
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "investment_darf_status_delete" ON public.investment_darf_status
  USING (household_id IN (SELECT private.user_household_ids()));

-- Membership combined with ownership.
ALTER POLICY "categories_select" ON public.categories
  USING (household_id IN (SELECT private.user_household_ids()));
ALTER POLICY "categories_insert" ON public.categories
  WITH CHECK (
    household_id IN (SELECT private.user_household_ids())
    AND created_by_user_id = (select auth.uid())
  );
ALTER POLICY "categories_update" ON public.categories
  USING (
    household_id IN (SELECT private.user_household_ids())
    AND created_by_user_id = (select auth.uid())
  )
  WITH CHECK (
    household_id IN (SELECT private.user_household_ids())
    AND created_by_user_id = (select auth.uid())
  );
ALTER POLICY "categories_delete" ON public.categories
  USING (
    household_id IN (SELECT private.user_household_ids())
    AND created_by_user_id = (select auth.uid())
  );

ALTER POLICY "user_category_exclusions_select_own" ON public.user_category_exclusions
  USING (
    user_id = (select auth.uid())
    AND household_id IN (SELECT private.user_household_ids())
  );
ALTER POLICY "user_category_exclusions_insert_own" ON public.user_category_exclusions
  WITH CHECK (
    user_id = (select auth.uid())
    AND household_id IN (SELECT private.user_household_ids())
  );
ALTER POLICY "user_category_exclusions_delete_own" ON public.user_category_exclusions
  USING (
    user_id = (select auth.uid())
    AND household_id IN (SELECT private.user_household_ids())
  );

-- Transactions: per-user access rows, also as a set.
ALTER POLICY "transactions_select_with_access" ON public.transactions
  USING (id IN (SELECT private.user_readable_transaction_ids()));
ALTER POLICY "transactions_update_with_edit" ON public.transactions
  USING (id IN (SELECT private.user_editable_transaction_ids()))
  WITH CHECK (
    id IN (SELECT private.user_editable_transaction_ids())
    AND household_id IN (SELECT private.user_household_ids())
  );
ALTER POLICY "transactions_delete_with_edit" ON public.transactions
  USING (id IN (SELECT private.user_editable_transaction_ids()));

-- Indexes for filters the app runs on every page and for ON DELETE cascades
-- over the large tables. Foreign keys on small, rarely filtered tables are
-- left without one on purpose.
CREATE INDEX IF NOT EXISTS household_members_user_idx
  ON public.household_members (user_id);
CREATE INDEX IF NOT EXISTS transaction_access_user_idx
  ON public.transaction_access (user_id, transaction_id);
CREATE INDEX IF NOT EXISTS transactions_category_idx
  ON public.transactions (category_id);
CREATE INDEX IF NOT EXISTS transactions_subcategory_idx
  ON public.transactions (subcategory_id);
CREATE INDEX IF NOT EXISTS transactions_owner_profile_idx
  ON public.transactions (owner_profile_id);
CREATE INDEX IF NOT EXISTS transaction_imports_household_idx
  ON public.transaction_imports (household_id, created_at DESC);
CREATE INDEX IF NOT EXISTS investment_quotes_household_idx
  ON public.investment_quotes (household_id, id);
CREATE INDEX IF NOT EXISTS investment_snapshots_asset_idx
  ON public.investment_snapshots (asset_id);
CREATE INDEX IF NOT EXISTS investment_events_asset_idx
  ON public.investment_events (asset_id);
