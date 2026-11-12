-- A member removed from a household kept every transaction_access row they had
-- in it. The transactions policies only look at transaction_access, so with
-- their own JWT and the public anon key the former member could still read and
-- delete those transactions through the REST API; the app hid them, the API did
-- not. (UPDATE was already refused by the WITH CHECK on membership.)
--
-- Leaving or being removed from a household now drops the person's access to
-- that household's transactions, and rows left behind by earlier removals are
-- cleaned up here. The trigger function runs as its owner so the cleanup also
-- happens when the delete comes from a role that could not touch every access
-- row; nobody calls it directly, so EXECUTE is revoked from every API role.

CREATE OR REPLACE FUNCTION private.revoke_transaction_access_on_member_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.transaction_access ta
  USING public.transactions t
  WHERE t.id = ta.transaction_id
    AND t.household_id = OLD.household_id
    AND ta.user_id = OLD.user_id;
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION private.revoke_transaction_access_on_member_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION private.revoke_transaction_access_on_member_delete() FROM anon, authenticated;

DROP TRIGGER IF EXISTS revoke_transaction_access_on_member_delete ON public.household_members;
CREATE TRIGGER revoke_transaction_access_on_member_delete
  AFTER DELETE ON public.household_members
  FOR EACH ROW
  EXECUTE FUNCTION private.revoke_transaction_access_on_member_delete();

-- Access rows of people who are no longer members of the transaction's
-- household (removed before this trigger existed).
DELETE FROM public.transaction_access ta
USING public.transactions t
WHERE t.id = ta.transaction_id
  AND NOT EXISTS (
    SELECT 1 FROM public.household_members hm
    WHERE hm.household_id = t.household_id
      AND hm.user_id = ta.user_id
  );
