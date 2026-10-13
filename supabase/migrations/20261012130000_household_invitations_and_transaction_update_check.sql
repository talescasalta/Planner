-- Two authorization fixes.
--
-- 1. Joining a group now takes the invitee's consent. Until now an admin added
--    anyone by e-mail straight into household_members. Since the app treats a
--    person's oldest membership as their household, someone who had just signed
--    up could be pulled into a stranger's group before creating their own, and
--    everything they imported afterwards landed there. An admin now records an
--    invitation; the membership only exists once the invitee accepts it.
--
--    The table is written and read only by the server (service role), after
--    the action checks the session and the admin role, so it has RLS enabled
--    and no policy at all: deny-all for anon and authenticated.
--
-- 2. transactions_update_with_edit had no WITH CHECK, so Postgres reused the
--    USING expression for the new row. That expression only looks at the row's
--    id, which never changes, so whoever could edit a transaction could also
--    rewrite its household_id and move it into another household. The new row
--    must now belong to a household the user is a member of.

CREATE TABLE IF NOT EXISTS public.household_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- As the admin typed it, so the pending invitation can be shown by name.
  email text NOT NULL,
  invited_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, user_id)
);

CREATE INDEX IF NOT EXISTS household_invitations_user_idx
  ON public.household_invitations (user_id);

ALTER TABLE public.household_invitations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.household_invitations IS
  'Pending invitations to join a household. Server-only (no RLS policy): created by an admin, turned into a household_members row when the invitee accepts.';

DROP POLICY IF EXISTS "transactions_update_with_edit" ON public.transactions;
CREATE POLICY "transactions_update_with_edit"
  ON public.transactions
  FOR UPDATE
  USING (private.user_can_edit_transaction(id))
  WITH CHECK (
    private.user_can_edit_transaction(id)
    AND private.is_member_of_household(household_id)
  );
