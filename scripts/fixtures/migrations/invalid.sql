CREATE TABLE public.missing_rls (
  id uuid PRIMARY KEY
);

CREATE OR REPLACE FUNCTION private.missing_search_path(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT true;
$$;

CREATE OR REPLACE FUNCTION public.missing_revoke(p_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT true;
$$;
