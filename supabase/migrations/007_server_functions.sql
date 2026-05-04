-- Migration 007: Create server-safe functions for group creation
-- These bypass RLS via SECURITY DEFINER, called from SvelteKit server

CREATE OR REPLACE FUNCTION public.create_household(
  p_name text,
  p_creator_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid;
BEGIN
  INSERT INTO public.households (name)
  VALUES (p_name)
  RETURNING id INTO v_household_id;

  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (v_household_id, p_creator_user_id, 'admin');

  RETURN v_household_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_household_member(
  p_household_id uuid,
  p_user_id uuid,
  p_role text DEFAULT 'member'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (p_household_id, p_user_id, p_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_household_member(
  p_household_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.household_members
  WHERE household_id = p_household_id AND user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_default_categories(p_household_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.categories (household_id, name)
  VALUES
    (p_household_id, 'Moradia'),
    (p_household_id, 'Mercado'),
    (p_household_id, 'Restaurante / Delivery'),
    (p_household_id, 'Transporte'),
    (p_household_id, 'Saúde / Farmácia'),
    (p_household_id, 'Gestação / Bebê'),
    (p_household_id, 'Educação'),
    (p_household_id, 'Lazer'),
    (p_household_id, 'Assinaturas'),
    (p_household_id, 'Compras pessoais'),
    (p_household_id, 'Pets'),
    (p_household_id, 'Impostos / Taxas'),
    (p_household_id, 'Outros');
$$;

CREATE OR REPLACE FUNCTION public.seed_default_financial_profiles(p_household_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.financial_profiles (household_id, name, type)
  VALUES
    (p_household_id, 'Pessoa A', 'individual'),
    (p_household_id, 'Pessoa B', 'individual'),
    (p_household_id, 'Casal', 'shared');
$$;
