-- New households get exactly the default taxonomy the app shows: the pairs in
-- src/lib/server/data/gabarito-default.csv. The previous seed also created
-- subcategories outside that file, which filterCategoriesForUser hides anyway.
-- Existing households keep their categories untouched.

CREATE OR REPLACE FUNCTION public.seed_default_categories(p_household_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH taxonomy(parent_name, child_name) AS (
    VALUES
    ('Academia', 'Gympass'),
    ('Alimentação', 'Bar'),
    ('Alimentação', 'Café'),
    ('Alimentação', 'Delivery'),
    ('Alimentação', 'Doces e Sorvetes'),
    ('Alimentação', 'Padaria'),
    ('Alimentação', 'Restaurante'),
    ('Assinaturas', 'Adobe'),
    ('Assinaturas', 'Apple'),
    ('Assinaturas', 'Celular'),
    ('Assinaturas', 'GPT'),
    ('Assinaturas', 'Google'),
    ('Assinaturas', 'Streaming'),
    ('Assinaturas', 'Youtube'),
    ('Casa', 'Manutenção'),
    ('Casa', 'Móveis e Decoração'),
    ('Compras Online', 'AliExpress'),
    ('Compras Online', 'Amazon'),
    ('Compras Online', 'Mercado Livre'),
    ('Compras Online', 'Shopee'),
    ('Doação', 'Doação'),
    ('Lazer', 'Cinema'),
    ('Lazer', 'Futebol'),
    ('Lazer', 'Show'),
    ('Loterias e Jogos', 'Loterias'),
    ('Mercado', 'Mercado'),
    ('Mercado', 'Mercearia'),
    ('Mercado', 'Mini Mercado'),
    ('Mercado', 'Padaria'),
    ('Mercado', 'Quitanda'),
    ('Outros', 'Carro'),
    ('Outros', 'Outros'),
    ('Outros', 'Presente'),
    ('Pagamento', 'Pagamento'),
    ('Pet', 'Petshop'),
    ('Saúde', 'Farmácia'),
    ('Transporte', '99'),
    ('Transporte', 'Combustível'),
    ('Transporte', 'Estacionamento'),
    ('Transporte', 'Pedágio'),
    ('Transporte', 'Uber'),
    ('Vestuário', 'Roupas'),
    ('Vestuário', 'Tênis'),
    ('Vestuário', 'Óculos'),
    ('Viagem', 'Airbnb'),
    ('Viagem', 'Hotel'),
    ('Viagem', 'Passagem'),
    ('Viagem', 'Pousada')
  ),
  parent_names AS (
    SELECT DISTINCT parent_name FROM taxonomy
  ),
  parent_inserts AS (
    INSERT INTO public.categories (household_id, name, created_by_user_id, is_default)
    SELECT p_household_id, pn.parent_name, NULL, true
    FROM parent_names pn
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.household_id = p_household_id
        AND c.parent_id IS NULL
        AND c.created_by_user_id IS NULL
        AND lower(c.name) = lower(pn.parent_name)
    )
    RETURNING id
  ),
  parents AS (
    SELECT DISTINCT ON (lower(name))
      id,
      name
    FROM public.categories
    WHERE household_id = p_household_id
      AND parent_id IS NULL
      AND created_by_user_id IS NULL
    ORDER BY lower(name), created_at, id
  )
  INSERT INTO public.categories (household_id, name, parent_id, created_by_user_id, is_default)
  SELECT p_household_id, t.child_name, p.id, NULL, true
  FROM parents p
  JOIN taxonomy t ON lower(t.parent_name) = lower(p.name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.household_id = p_household_id
      AND c.parent_id = p.id
      AND c.created_by_user_id IS NULL
      AND lower(c.name) = lower(t.child_name)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_default_categories(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_categories(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_categories(uuid) TO service_role;
