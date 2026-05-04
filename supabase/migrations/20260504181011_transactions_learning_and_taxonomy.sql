-- Add subcategory support to learned rules and align existing households
-- with the gabarito taxonomy used by the classifier.

ALTER TABLE public.classification_rules
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;

WITH ranked_rules AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY household_id, created_by_user_id, pattern_type, pattern
      ORDER BY active DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.classification_rules
)
DELETE FROM public.classification_rules cr
USING ranked_rules rr
WHERE cr.id = rr.id
  AND rr.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS classification_rules_personal_pattern_idx
  ON public.classification_rules (household_id, created_by_user_id, pattern_type, pattern);

-- Shared assignment should be shown as the group name, not "Casal".
UPDATE public.financial_profiles fp
SET name = h.name
FROM public.households h
WHERE fp.household_id = h.id
  AND fp.type = 'shared';

-- Ensure every household has one shared profile.
INSERT INTO public.financial_profiles (household_id, name, type)
SELECT h.id, h.name, 'shared'
FROM public.households h
WHERE NOT EXISTS (
  SELECT 1
  FROM public.financial_profiles fp
  WHERE fp.household_id = h.id
    AND fp.type = 'shared'
);

-- Ensure every member has an individual assignment profile.
INSERT INTO public.financial_profiles (household_id, user_id, name, type)
SELECT hm.household_id, hm.user_id, COALESCE(NULLIF(p.display_name, ''), 'Pessoa'), 'individual'
FROM public.household_members hm
LEFT JOIN public.profiles p ON p.user_id = hm.user_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.financial_profiles fp
  WHERE fp.household_id = hm.household_id
    AND fp.user_id = hm.user_id
    AND fp.type = 'individual'
);

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
  SELECT h.id, pn.parent_name
  FROM public.households h
  CROSS JOIN parent_names pn
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.household_id = h.id
      AND c.parent_id IS NULL
      AND lower(c.name) = lower(pn.parent_name)
  )
  RETURNING id
),
parents AS (
  SELECT DISTINCT ON (household_id, lower(name))
    id,
    household_id,
    name
  FROM public.categories
  WHERE parent_id IS NULL
  ORDER BY household_id, lower(name), created_at, id
)
INSERT INTO public.categories (household_id, name, parent_id)
SELECT p.household_id, t.child_name, p.id
FROM parents p
JOIN taxonomy t ON lower(t.parent_name) = lower(p.name)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.categories c
  WHERE c.household_id = p.household_id
    AND c.parent_id = p.id
    AND lower(c.name) = lower(t.child_name)
);
