-- Moving money between accounts the household already owns is neither an
-- expense nor income, but it arrives on a statement looking exactly like one.
--
-- A Pix to your own account shows up as a debit, so it inflates expenses. Once
-- the receiving account is imported too, the matching credit inflates income by
-- the same amount: the balance nets out while both totals are wrong.
--
-- Flagging both legs and excluding them from the totals makes them cancel
-- without any need to pair them up, which matters because the two legs may be
-- imported months apart, or never both imported at all.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS is_transfer boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.transactions.is_transfer IS
  'Movement between accounts the household owns. Excluded from expense, credit and balance totals; still listed and classifiable.';

-- Every aggregation filters on this, always alongside household_id.
CREATE INDEX IF NOT EXISTS transactions_household_is_transfer_idx
  ON public.transactions (household_id, is_transfer);
