-- Keep future assignment profiles aligned with the household/member model.

CREATE OR REPLACE FUNCTION public.seed_default_financial_profiles(p_household_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.financial_profiles (household_id, name, type)
  SELECT h.id, h.name, 'shared'
  FROM public.households h
  WHERE h.id = p_household_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.financial_profiles fp
      WHERE fp.household_id = h.id
        AND fp.type = 'shared'
    );

  INSERT INTO public.financial_profiles (household_id, user_id, name, type)
  SELECT hm.household_id, hm.user_id, COALESCE(NULLIF(p.display_name, ''), 'Pessoa'), 'individual'
  FROM public.household_members hm
  LEFT JOIN public.profiles p ON p.user_id = hm.user_id
  WHERE hm.household_id = p_household_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.financial_profiles fp
      WHERE fp.household_id = hm.household_id
        AND fp.user_id = hm.user_id
        AND fp.type = 'individual'
    );
$$;

CREATE OR REPLACE FUNCTION private.ensure_member_financial_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_display_name text;
BEGIN
  SELECT display_name INTO v_display_name
  FROM public.profiles
  WHERE user_id = NEW.user_id;

  INSERT INTO public.financial_profiles (household_id, user_id, name, type)
  VALUES (NEW.household_id, NEW.user_id, COALESCE(NULLIF(v_display_name, ''), 'Pessoa'), 'individual')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_member_financial_profile ON public.household_members;
CREATE TRIGGER ensure_member_financial_profile
  AFTER INSERT ON public.household_members
  FOR EACH ROW
  EXECUTE FUNCTION private.ensure_member_financial_profile();

REVOKE EXECUTE ON FUNCTION public.seed_default_financial_profiles(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_financial_profiles(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_financial_profiles(uuid) TO service_role;
