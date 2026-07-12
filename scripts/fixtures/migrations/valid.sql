CREATE TABLE public.safe_table (
  id uuid PRIMARY KEY
);

ALTER TABLE public.safe_table ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.safe_function(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT true;
$$;

REVOKE EXECUTE ON FUNCTION public.safe_function(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.safe_function(uuid) FROM anon, authenticated;
