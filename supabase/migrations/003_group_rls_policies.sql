-- Migration 003: Allow group creation and self-insert for first member

-- Allow authenticated users to create households
CREATE POLICY "households_insert_authenticated"
  ON public.households
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow authenticated users to add themselves as the first member of a household
CREATE POLICY "household_members_insert_first_member"
  ON public.household_members
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = household_members.household_id
    )
  );

-- Allow household members to delete other members (for group management)
CREATE POLICY "household_members_delete_members"
  ON public.household_members
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = household_members.household_id AND hm.user_id = auth.uid()
    )
  );
