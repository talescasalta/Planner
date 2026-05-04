-- Seed future households with the category/subcategory taxonomy from Cartão de Crédito.csv.

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
    ('Alimentação', 'Nubank'),
    ('Alimentação', 'Outros'),
    ('Alimentação', 'Padaria'),
    ('Alimentação', 'Restaurante'),
    ('Assinaturas', 'Adobe'),
    ('Assinaturas', 'Apple'),
    ('Assinaturas', 'Babbel'),
    ('Assinaturas', 'Bitdefender'),
    ('Assinaturas', 'Casa do Saber'),
    ('Assinaturas', 'Celular'),
    ('Assinaturas', 'Elsa Speak'),
    ('Assinaturas', 'Gforce'),
    ('Assinaturas', 'Google'),
    ('Assinaturas', 'GPT'),
    ('Assinaturas', 'Kinvo'),
    ('Assinaturas', 'Max'),
    ('Assinaturas', 'Meli'),
    ('Assinaturas', 'Mubi'),
    ('Assinaturas', 'Nexo'),
    ('Assinaturas', 'Openrouter'),
    ('Assinaturas', 'Premier'),
    ('Assinaturas', 'Prime'),
    ('Assinaturas', 'Seguro de Vida'),
    ('Assinaturas', 'Spotify'),
    ('Assinaturas', 'Streaming'),
    ('Assinaturas', 'Youtube'),
    ('Casa', 'Manutenção'),
    ('Casa', 'Móveis e Decoração'),
    ('Compras Online', 'AliExpress'),
    ('Compras Online', 'Amazon'),
    ('Compras Online', 'Grabr'),
    ('Compras Online', 'Mercado Livre'),
    ('Compras Online', 'OLX'),
    ('Compras Online', 'Shopee'),
    ('Doação', 'Doação'),
    ('Lazer', 'Cinema'),
    ('Lazer', 'Futebol'),
    ('Lazer', 'Lazer'),
    ('Lazer', 'Sesc'),
    ('Lazer', 'Show'),
    ('Loterias e Jogos', 'Loterias'),
    ('Mercado', 'Armazém'),
    ('Mercado', 'Bebidas'),
    ('Mercado', 'Café'),
    ('Mercado', 'Carrefour'),
    ('Mercado', 'Dia'),
    ('Mercado', 'Mambo'),
    ('Mercado', 'Mercado'),
    ('Mercado', 'Mercearia'),
    ('Mercado', 'Mini Mercado'),
    ('Mercado', 'Oba'),
    ('Mercado', 'Outros'),
    ('Mercado', 'Oxxo'),
    ('Mercado', 'Padaria'),
    ('Mercado', 'Pão'),
    ('Mercado', 'Pão de Açúcar'),
    ('Mercado', 'Pomar'),
    ('Mercado', 'Quitanda'),
    ('Mercado', 'St Marche'),
    ('Mercado', 'Zaffari'),
    ('Originare', 'Originare'),
    ('Outros', 'Bicicleta'),
    ('Outros', 'Carro'),
    ('Outros', 'Juju'),
    ('Outros', 'Lazer'),
    ('Outros', 'Outros'),
    ('Outros', 'Plantas'),
    ('Outros', 'Presente'),
    ('Outros', 'Viagem'),
    ('Pagamento', 'Pagamento'),
    ('Pet', 'Petshop'),
    ('Saúde', 'Farmácia'),
    ('Transporte', '99'),
    ('Transporte', 'Aluguel de Carros'),
    ('Transporte', 'Combustível'),
    ('Transporte', 'Estacionamento'),
    ('Transporte', 'Ferry/Barco'),
    ('Transporte', 'Lava Jato'),
    ('Transporte', 'Manutenção'),
    ('Transporte', 'Pedágio'),
    ('Transporte', 'Uber'),
    ('Vestuário', 'Carteira'),
    ('Vestuário', 'Nike'),
    ('Vestuário', 'Óculos'),
    ('Vestuário', 'Presente'),
    ('Vestuário', 'Roupas'),
    ('Vestuário', 'Tênis'),
    ('Viagem', 'Airbnb'),
    ('Viagem', 'Aluguel de Carros'),
    ('Viagem', 'Hotel'),
    ('Viagem', 'Outros'),
    ('Viagem', 'Passagem'),
    ('Viagem', 'Pousada'),
    ('Viagem', 'Restaurante'),
    ('Viagem', 'Viagem')
  ),
  parent_names AS (
    SELECT DISTINCT parent_name FROM taxonomy
  ),
  parent_inserts AS (
    INSERT INTO public.categories (household_id, name)
    SELECT p_household_id, pn.parent_name
    FROM parent_names pn
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.categories c
      WHERE c.household_id = p_household_id
        AND c.parent_id IS NULL
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
    ORDER BY lower(name), created_at, id
  )
  INSERT INTO public.categories (household_id, name, parent_id)
  SELECT p_household_id, t.child_name, p.id
  FROM parents p
  JOIN taxonomy t ON lower(t.parent_name) = lower(p.name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.household_id = p_household_id
      AND c.parent_id = p.id
      AND lower(c.name) = lower(t.child_name)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_default_categories(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_categories(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_categories(uuid) TO service_role;
