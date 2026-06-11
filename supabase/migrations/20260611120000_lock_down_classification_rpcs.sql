-- Migration: Lock down classification RPCs.
--
-- Both functions below are SECURITY DEFINER and were executable by `anon` and
-- `authenticated` via /rest/v1/rpc/*. That allowed any signed-in user to call
-- apply_transaction_classification_updates with household_id = null and update
-- transactions belonging to ANY household, bypassing RLS entirely.
--
-- Fixes:
--   1. apply_transaction_classification_updates now requires a non-null
--      household_id on every row (defense in depth).
--   2. EXECUTE is revoked from PUBLIC / anon / authenticated and granted only
--      to service_role. The app calls these through the server-side admin
--      client (src/lib/server/supabase.ts) after validating household
--      membership with the user-scoped, RLS-enforced client.

CREATE OR REPLACE FUNCTION public.apply_transaction_classification_updates(updates jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF jsonb_typeof(updates) <> 'array' THEN
    RAISE EXCEPTION 'updates must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(updates) AS elem
    WHERE elem->>'household_id' IS NULL OR elem->>'id' IS NULL
  ) THEN
    RAISE EXCEPTION 'every update must include id and household_id';
  END IF;

  WITH payload AS (
    SELECT *
    FROM jsonb_to_recordset(updates) AS x(
      id uuid,
      household_id uuid,
      category_id uuid,
      subcategory_id uuid,
      owner_profile_id uuid,
      classification_method text,
      classification_confidence numeric,
      review_status text,
      classification_suggestion jsonb
    )
  ),
  updated AS (
    UPDATE public.transactions t
    SET
      category_id = p.category_id,
      subcategory_id = p.subcategory_id,
      owner_profile_id = p.owner_profile_id,
      classification_method = p.classification_method,
      classification_confidence = p.classification_confidence,
      review_status = p.review_status,
      classification_suggestion = p.classification_suggestion,
      updated_at = now()
    FROM payload p
    WHERE t.id = p.id
      AND t.household_id = p.household_id
    RETURNING t.id
  )
  SELECT count(*) INTO updated_count FROM updated;

  RETURN updated_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_transaction_classification_updates(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_transaction_classification_updates(jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_transaction_classification_updates(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_classification_rate_limit(uuid, integer, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_classification_rate_limit(uuid, integer, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_classification_rate_limit(uuid, integer, integer, integer) TO service_role;
