-- This migration version already exists in the linked production database,
-- but its original timestamp is not present in the repository history.
--
-- Its recorded statements are identical to the tracked
-- 20260903150000_reference_month_by_transaction_date migration. Keep the
-- remote version locally as a no-op history marker; the tracked migration
-- remains the reproducible source for a fresh database.
SELECT 1;
