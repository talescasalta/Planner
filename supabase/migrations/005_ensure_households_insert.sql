-- Migration 005: Ensure households INSERT policy exists
-- And allow reading households the user created (before member row exists)

DROP POLICY IF EXISTS "households_insert_authenticated" ON public.households;
DROP POLICY IF EXISTS "households_select" ON public.households;

CREATE POLICY "households_insert_authenticated"
  ON public.households
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow reading households where user is a member OR that the user just created
CREATE POLICY "households_select"
  ON public.households
  FOR SELECT
  USING (
    public.is_member_of_household(id)
    OR EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = id AND hm.user_id = auth.uid()
    )
  );
