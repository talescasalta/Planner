-- Invitations are addressed to an e-mail, not to an account that already
-- exists. Resolving the account at invite time made "Convidar membro" answer
-- differently for registered and unregistered addresses, so anyone who
-- created a group could probe which e-mails have an account here, and it had
-- to page through every auth user to find one. The invitee now sees the
-- invitation when signed in with that e-mail, whether the account existed
-- when it was sent or was created afterwards.
--
-- add_member already stored the e-mail lowercased; the check keeps it so.
-- Dropping user_id also drops the unique constraint and index built on it.

ALTER TABLE public.household_invitations DROP COLUMN IF EXISTS user_id;

ALTER TABLE public.household_invitations
  ADD CONSTRAINT household_invitations_email_lowercase CHECK (email = lower(email));

ALTER TABLE public.household_invitations
  ADD CONSTRAINT household_invitations_household_email_key UNIQUE (household_id, email);

CREATE INDEX IF NOT EXISTS household_invitations_email_idx
  ON public.household_invitations (email);
