-- The names a household's own accounts print on statements, e.g.
-- {"Tales Casalta", "Tales C"}: Nubank shows the full name while Itaú
-- truncates it. Imports use them to tell a Pix between the household's own
-- accounts from a payment to someone else with the same amount. Nothing is
-- inferred when the list is empty, and no existing data is changed.

ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS own_account_names text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.households.own_account_names IS
  'Names the household''s own accounts show on statements; used to suggest transfers between those accounts.';
