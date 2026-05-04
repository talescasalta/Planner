-- Migration 010: Harden household administration and transaction access RLS.

CREATE OR REPLACE FUNCTION public.is_admin_of_household(p_household_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = p_household_id
      AND user_id = auth.uid()
      AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.transaction_household_id(p_transaction_id uuid)
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

CREATE OR REPLACE FUNCTION public.user_belongs_to_transaction_household(
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

CREATE OR REPLACE FUNCTION public.user_can_manage_transaction_access(p_transaction_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_can_edit_transaction(p_transaction_id)
    OR public.is_admin_of_household(public.transaction_household_id(p_transaction_id));
$$;

DROP POLICY IF EXISTS "household_members_insert_existing_member" ON public.household_members;
DROP POLICY IF EXISTS "household_members_delete" ON public.household_members;

CREATE POLICY "household_members_insert_existing_admin"
  ON public.household_members
  FOR INSERT
  WITH CHECK (public.is_admin_of_household(household_id));

CREATE POLICY "household_members_delete_admin"
  ON public.household_members
  FOR DELETE
  USING (public.is_admin_of_household(household_id));

DROP POLICY IF EXISTS "transaction_access_insert" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_update" ON public.transaction_access;
DROP POLICY IF EXISTS "transaction_access_delete" ON public.transaction_access;

CREATE POLICY "transaction_access_insert"
  ON public.transaction_access
  FOR INSERT
  WITH CHECK (
    public.user_can_manage_transaction_access(transaction_id)
    AND public.user_belongs_to_transaction_household(transaction_id, user_id)
  );

CREATE POLICY "transaction_access_update"
  ON public.transaction_access
  FOR UPDATE
  USING (public.user_can_manage_transaction_access(transaction_id))
  WITH CHECK (
    public.user_can_manage_transaction_access(transaction_id)
    AND public.user_belongs_to_transaction_household(transaction_id, user_id)
  );

CREATE POLICY "transaction_access_delete"
  ON public.transaction_access
  FOR DELETE
  USING (public.user_can_manage_transaction_access(transaction_id));
