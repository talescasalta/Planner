CREATE TABLE IF NOT EXISTS public.classification_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS classification_rate_limits_user_created_idx
  ON public.classification_rate_limits (user_id, created_at DESC);

ALTER TABLE public.classification_rate_limits ENABLE ROW LEVEL SECURITY;

-- No RLS policies are defined intentionally. This table is only accessed with
-- the server-side service role through check_classification_rate_limit.

CREATE OR REPLACE FUNCTION public.check_classification_rate_limit(
  p_user_id uuid,
  p_window_seconds integer,
  p_max_requests integer,
  p_cleanup_seconds integer DEFAULT 3600
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id::text));

  DELETE FROM public.classification_rate_limits
  WHERE created_at < now() - make_interval(secs => p_cleanup_seconds);

  SELECT count(*)
  INTO recent_count
  FROM public.classification_rate_limits
  WHERE user_id = p_user_id
    AND created_at >= now() - make_interval(secs => p_window_seconds);

  IF recent_count >= p_max_requests THEN
    RETURN false;
  END IF;

  INSERT INTO public.classification_rate_limits (user_id)
  VALUES (p_user_id);

  RETURN true;
END;
$$;

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
      AND (p.household_id IS NULL OR t.household_id = p.household_id)
    RETURNING t.id
  )
  SELECT count(*) INTO updated_count FROM updated;

  RETURN updated_count;
END;
$$;
