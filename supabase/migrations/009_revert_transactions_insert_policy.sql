-- Migration 009: Restore the original transactions INSERT policy form
-- Migration 008 changed INSERT to use is_member_of_household(); some users
-- hit "new row violates RLS" on import. INSERT never had recursion (it only
-- references household_members), so use a direct EXISTS check like the
-- original 001 migration.

DROP POLICY IF EXISTS "transactions_insert_members" ON public.transactions;

CREATE POLICY "transactions_insert_members"
  ON public.transactions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.household_members hm
      WHERE hm.household_id = transactions.household_id
        AND hm.user_id = auth.uid()
    )
  );
