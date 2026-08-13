-- Backfills source_type on rows imported before the column existed.
--
-- These rows carry no link to their import: transactions have no import id,
-- and source_name was never populated for them. What they do have is a shared
-- created_at, because every row of an import is written in one statement. That
-- groups them into three batches, and each batch carries converging evidence
-- of what it was:
--
--   2026-05-14, 121 rows, dates 27/03-25/04, 4 credits
--     descriptions carry installment markers ("Parcela 4/10", "3/5"), which
--     only appear on credit card statements, and the 26th-to-25th date range
--     is an invoice cycle -> credit_card
--
--   2026-06-01, 112 rows, dates 26/04-26/05, 2 credits
--     same installment markers, same invoice-shaped range -> credit_card
--
--   2026-06-02, 32 rows, dates 01/05-29/05, 11 credits
--     descriptions are raw Nubank bank statement lines ("Transferencia
--     enviada pelo Pix - ... Agencia: ... Conta: ..."), the range is a
--     calendar month, and the credit ratio is far too high for an invoice
--     -> bank_account
--
-- This only labels the rows. reference_month is deliberately left alone:
-- all three batches already sit in the correct settlement cycle, so applying
-- the cycle rule to them would move nothing. Verified before writing this.
--
-- Other environments have no rows matching these windows, so the statements
-- below are no-ops there.

UPDATE public.transactions
SET source_type = 'credit_card'
WHERE source_type IS NULL
  AND created_at >= timestamptz '2026-05-14 00:00:00+00'
  AND created_at < timestamptz '2026-05-15 00:00:00+00';

UPDATE public.transactions
SET source_type = 'credit_card'
WHERE source_type IS NULL
  AND created_at >= timestamptz '2026-06-01 00:00:00+00'
  AND created_at < timestamptz '2026-06-02 00:00:00+00';

UPDATE public.transactions
SET source_type = 'bank_account'
WHERE source_type IS NULL
  AND created_at >= timestamptz '2026-06-02 00:00:00+00'
  AND created_at < timestamptz '2026-06-03 00:00:00+00';
