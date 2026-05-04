-- Migration 006: Ensure all household policies are correct

-- Ensure INSERT policy exists
DROP POLICY IF EXISTS "households_insert_authenticated" ON public.households;
CREATE POLICY "households_insert_authenticated"
  ON public.households
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Ensure SELECT policy uses helper function
DROP POLICY IF EXISTS "households_select" ON public.households;
DROP POLICY IF EXISTS "households_select_members" ON public.households;
CREATE POLICY "households_select"
  ON public.households
  FOR SELECT
  USING (public.is_member_of_household(id));

-- Ensure helper functions exist (idempotent)
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
