-- Testes de RLS com pgTAP. Rodam via `supabase test db` (CI) contra um banco
-- local com todas as migrations aplicadas. Cobrem os três invariantes de
-- segurança do SECURITY.md: anon não lê nada, membros de um household não
-- alcançam dados de outro, e RPCs SECURITY DEFINER negam anon/authenticated.
--
-- Tudo roda numa transação com ROLLBACK ao final: nenhum seed persiste.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = extensions, public;

-- ============================================================
-- Seeds (como superusuário: RLS não se aplica aqui de propósito)
-- ============================================================
-- Usuário A pertence ao household A; usuário B ao household B.

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
VALUES
	('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'user-a@rls.test', '', now(), '{}', '{}'),
	('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'user-b@rls.test', '', now(), '{}', '{}');

INSERT INTO public.households (id, name) VALUES
	('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Household A'),
	('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Household B');

INSERT INTO public.household_members (household_id, user_id, role) VALUES
	('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin'),
	('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'admin');

-- profiles são criados pelo trigger on_auth_user_created; não inserir manualmente.

INSERT INTO public.categories (id, household_id, name) VALUES
	('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Categoria A'),
	('bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Categoria B');

-- financial_profiles são criados pelo trigger ensure_member_financial_profile
-- ao inserir household_members; não inserir manualmente.

INSERT INTO public.transactions (id, household_id, date, description, amount, created_by_user_id) VALUES
	('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-01-10', 'Compra do household A', -100.00, '11111111-1111-1111-1111-111111111111'),
	('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-01-11', 'Compra do household B', -200.00, '22222222-2222-2222-2222-222222222222');

INSERT INTO public.transaction_access (id, transaction_id, user_id, can_read, can_edit) VALUES
	('aaaaaaaa-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', true, true),
	('bbbbbbbb-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', true, true);

INSERT INTO public.classification_rules (id, household_id, pattern, pattern_type, created_by_user_id) VALUES
	('aaaaaaaa-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mercado a', 'merchant_contains', '11111111-1111-1111-1111-111111111111'),
	('bbbbbbbb-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'mercado b', 'merchant_contains', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.transaction_imports (id, household_id, created_by_user_id, source_filename) VALUES
	('aaaaaaaa-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'fatura-a.csv'),
	('bbbbbbbb-0000-0000-0000-000000000006', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'fatura-b.csv');

INSERT INTO public.classification_jobs (id, household_id, created_by_user_id, status) VALUES
	('aaaaaaaa-0000-0000-0000-000000000007', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'pending'),
	('bbbbbbbb-0000-0000-0000-000000000007', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'pending');

INSERT INTO public.audit_events (id, household_id, user_id, event_type, entity_type) VALUES
	('aaaaaaaa-0000-0000-0000-000000000008', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'test', 'transaction'),
	('bbbbbbbb-0000-0000-0000-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'test', 'transaction');

INSERT INTO public.user_category_exclusions (id, household_id, user_id, category_id) VALUES
	('aaaaaaaa-0000-0000-0000-000000000009', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002'),
	('bbbbbbbb-0000-0000-0000-000000000009', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000002');

INSERT INTO public.investment_assets (id, household_id, owner_user_id, asset_class, name, product_key, tax_bucket) VALUES
	('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'etf', 'ETF A', 'ETFA11', 'etf_rv'),
	('bbbbbbbb-0000-0000-0000-00000000000a', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'etf', 'ETF B', 'ETFB11', 'etf_rv');

INSERT INTO public.investment_snapshots (id, household_id, asset_id, snapshot_date, quantity, net_value) VALUES
	('aaaaaaaa-0000-0000-0000-00000000000b', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-00000000000a', '2026-08-01', 10, 1000),
	('bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-00000000000a', '2026-08-01', 20, 2000);

INSERT INTO public.investment_events (id, household_id, asset_id, event_date, event_type, direction, raw_product, source, dedup_key) VALUES
	('aaaaaaaa-0000-0000-0000-00000000000c', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-00000000000a', '2026-08-02', 'Rendimento', 'credit', 'ETFA11 - ETF A', 'b3_movimentacao', 'seed-a'),
	('bbbbbbbb-0000-0000-0000-00000000000c', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-00000000000a', '2026-08-02', 'Rendimento', 'credit', 'ETFB11 - ETF B', 'b3_movimentacao', 'seed-b');

INSERT INTO public.investment_quotes (id, household_id, asset_id, quote_date, price, source) VALUES
	('aaaaaaaa-0000-0000-0000-00000000000d', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-0000-0000-0000-00000000000a', '2026-08-03', 100, 'brapi'),
	('bbbbbbbb-0000-0000-0000-00000000000d', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-0000-0000-0000-00000000000a', '2026-08-03', 200, 'brapi');

INSERT INTO public.investment_darf_status (id, household_id, owner_user_id, reference_month, paid) VALUES
	('aaaaaaaa-0000-0000-0000-00000000000e', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '2026-08-01', false),
	('bbbbbbbb-0000-0000-0000-00000000000e', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', '2026-08-01', false);

-- Tabela interna deny-all: linhas existem, mas nenhuma role da API pode vê-las.
INSERT INTO public.classification_rate_limits (user_id) VALUES
	('11111111-1111-1111-1111-111111111111'),
	('22222222-2222-2222-2222-222222222222');

-- No Supabase hosted as roles da API recebem grants de tabela por default
-- privileges e o RLS é a fronteira por linhas. O banco local do CLI não
-- replica esses grants para objetos criados via migrations, então os
-- concedemos aqui (dentro da transação; somem no ROLLBACK) para testar o
-- mesmo cenário do ambiente real.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

SELECT plan(59);

-- ============================================================
-- 1. anon não lê nada (todas as 18 tabelas públicas)
-- ============================================================
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;

SELECT is_empty('SELECT id FROM public.households', 'anon não lê households');
SELECT is_empty('SELECT id FROM public.household_members', 'anon não lê household_members');
SELECT is_empty('SELECT id FROM public.profiles', 'anon não lê profiles');
SELECT is_empty('SELECT id FROM public.financial_profiles', 'anon não lê financial_profiles');
SELECT is_empty('SELECT id FROM public.categories', 'anon não lê categories');
SELECT is_empty('SELECT id FROM public.transactions', 'anon não lê transactions');
SELECT is_empty('SELECT id FROM public.transaction_access', 'anon não lê transaction_access');
SELECT is_empty('SELECT id FROM public.classification_rules', 'anon não lê classification_rules');
SELECT is_empty('SELECT id FROM public.transaction_imports', 'anon não lê transaction_imports');
SELECT is_empty('SELECT id FROM public.classification_jobs', 'anon não lê classification_jobs');
SELECT is_empty('SELECT id FROM public.audit_events', 'anon não lê audit_events');
SELECT is_empty('SELECT id FROM public.user_category_exclusions', 'anon não lê user_category_exclusions');
SELECT is_empty('SELECT id FROM public.classification_rate_limits', 'anon não lê classification_rate_limits');
SELECT is_empty('SELECT id FROM public.investment_assets', 'anon não lê investment_assets');
SELECT is_empty('SELECT id FROM public.investment_snapshots', 'anon não lê investment_snapshots');
SELECT is_empty('SELECT id FROM public.investment_events', 'anon não lê investment_events');
SELECT is_empty('SELECT id FROM public.investment_quotes', 'anon não lê investment_quotes');
SELECT is_empty('SELECT id FROM public.investment_darf_status', 'anon não lê investment_darf_status');

SELECT throws_ok(
	$$INSERT INTO public.transactions (household_id, date, description, amount, created_by_user_id)
	  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-01-12', 'anon insert', -1, '11111111-1111-1111-1111-111111111111')$$,
	'42501',
	NULL,
	'anon não insere transactions'
);

RESET ROLE;

-- ============================================================
-- 2. Usuário A enxerga somente o household A
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SET LOCAL ROLE authenticated;

SELECT results_eq('SELECT id FROM public.households', ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid], 'A vê só o próprio household');
SELECT results_eq('SELECT user_id FROM public.household_members', ARRAY['11111111-1111-1111-1111-111111111111'::uuid], 'A vê só membros do próprio household');
SELECT results_eq('SELECT user_id FROM public.profiles', ARRAY['11111111-1111-1111-1111-111111111111'::uuid], 'A vê só o próprio profile');
SELECT results_eq('SELECT DISTINCT household_id FROM public.financial_profiles', ARRAY['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid], 'A vê só financial_profiles do household A');
SELECT results_eq('SELECT id FROM public.categories', ARRAY['aaaaaaaa-0000-0000-0000-000000000002'::uuid], 'A vê só categorias do household A');
SELECT results_eq('SELECT id FROM public.transactions', ARRAY['aaaaaaaa-0000-0000-0000-000000000001'::uuid], 'A vê só transações do household A');
SELECT results_eq('SELECT id FROM public.transaction_access', ARRAY['aaaaaaaa-0000-0000-0000-000000000004'::uuid], 'A vê só transaction_access do household A');
SELECT results_eq('SELECT id FROM public.classification_rules', ARRAY['aaaaaaaa-0000-0000-0000-000000000005'::uuid], 'A vê só regras do household A');
SELECT results_eq('SELECT id FROM public.transaction_imports', ARRAY['aaaaaaaa-0000-0000-0000-000000000006'::uuid], 'A vê só imports do household A');
SELECT results_eq('SELECT id FROM public.classification_jobs', ARRAY['aaaaaaaa-0000-0000-0000-000000000007'::uuid], 'A vê só jobs do household A');
SELECT results_eq('SELECT id FROM public.audit_events', ARRAY['aaaaaaaa-0000-0000-0000-000000000008'::uuid], 'A vê só audit_events do household A');
SELECT results_eq('SELECT id FROM public.user_category_exclusions', ARRAY['aaaaaaaa-0000-0000-0000-000000000009'::uuid], 'A vê só as próprias exclusões');
SELECT is_empty('SELECT id FROM public.classification_rate_limits', 'classification_rate_limits nega até membros (deny-all)');
SELECT results_eq('SELECT id FROM public.investment_assets', ARRAY['aaaaaaaa-0000-0000-0000-00000000000a'::uuid], 'A vê só ativos do household A');
SELECT results_eq('SELECT id FROM public.investment_snapshots', ARRAY['aaaaaaaa-0000-0000-0000-00000000000b'::uuid], 'A vê só snapshots do household A');
SELECT results_eq('SELECT id FROM public.investment_events', ARRAY['aaaaaaaa-0000-0000-0000-00000000000c'::uuid], 'A vê só eventos do household A');
SELECT results_eq('SELECT id FROM public.investment_quotes', ARRAY['aaaaaaaa-0000-0000-0000-00000000000d'::uuid], 'A vê só cotações do household A');
SELECT results_eq('SELECT id FROM public.investment_darf_status', ARRAY['aaaaaaaa-0000-0000-0000-00000000000e'::uuid], 'A vê só DARFs do household A');

-- Escrita cruzada: A tentando alcançar o household B
SELECT throws_ok(
	$$INSERT INTO public.transactions (household_id, date, description, amount, created_by_user_id)
	  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-01-12', 'invasao', -1, '11111111-1111-1111-1111-111111111111')$$,
	'42501',
	NULL,
	'A não insere transação no household B'
);

-- Tentativas cruzadas de escrita: RLS filtra as linhas, então os comandos
-- abaixo executam sem erro mas devem atingir 0 linhas. A verificação de que
-- nada mudou é feita como superusuário logo após o RESET ROLE.
UPDATE public.transactions SET description = 'hacked'
WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

DELETE FROM public.transactions
WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

UPDATE public.households SET name = 'hacked'
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

SELECT throws_ok(
	$$INSERT INTO public.household_members (household_id, user_id, role)
	  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'member')$$,
	'42501',
	NULL,
	'A não se adiciona ao household B'
);

SELECT throws_ok(
	$$INSERT INTO public.categories (household_id, name)
	  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'invasora')$$,
	'42501',
	NULL,
	'A não cria categoria no household B'
);

SELECT is_empty(
	'SELECT id FROM public.households WHERE id = ''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb''',
	'A não enxerga o household B nem por id'
);

RESET ROLE;

-- Verificação (como superusuário) de que as escritas cruzadas não tiveram efeito
SELECT is(
	(SELECT description FROM public.transactions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'),
	'Compra do household B',
	'update cruzado de A não alterou a transação de B'
);
SELECT isnt_empty(
	'SELECT id FROM public.transactions WHERE id = ''bbbbbbbb-0000-0000-0000-000000000001''',
	'delete cruzado de A não apagou a transação de B'
);
SELECT is(
	(SELECT name FROM public.households WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
	'Household B',
	'update cruzado de A não renomeou o household B'
);

-- ============================================================
-- 3. Sanidade: usuário B enxerga os próprios dados
-- (garante que os testes acima não passam por falta de grants)
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
SET LOCAL ROLE authenticated;

SELECT results_eq('SELECT id FROM public.transactions', ARRAY['bbbbbbbb-0000-0000-0000-000000000001'::uuid], 'B vê a própria transação');
SELECT results_eq('SELECT id FROM public.households', ARRAY['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid], 'B vê o próprio household');

RESET ROLE;

-- ============================================================
-- 4. RPCs SECURITY DEFINER restritas ao service_role
-- ============================================================
SELECT ok(NOT has_function_privilege('anon', 'public.apply_transaction_classification_updates(jsonb)', 'EXECUTE'), 'anon não executa apply_transaction_classification_updates');
SELECT ok(NOT has_function_privilege('anon', 'public.check_classification_rate_limit(uuid, integer, integer, integer)', 'EXECUTE'), 'anon não executa check_classification_rate_limit');
SELECT ok(NOT has_function_privilege('anon', 'public.seed_default_categories(uuid)', 'EXECUTE'), 'anon não executa seed_default_categories');
SELECT ok(NOT has_function_privilege('anon', 'public.seed_default_financial_profiles(uuid)', 'EXECUTE'), 'anon não executa seed_default_financial_profiles');

SELECT ok(NOT has_function_privilege('authenticated', 'public.apply_transaction_classification_updates(jsonb)', 'EXECUTE'), 'authenticated não executa apply_transaction_classification_updates');
SELECT ok(NOT has_function_privilege('authenticated', 'public.check_classification_rate_limit(uuid, integer, integer, integer)', 'EXECUTE'), 'authenticated não executa check_classification_rate_limit');
SELECT ok(NOT has_function_privilege('authenticated', 'public.seed_default_categories(uuid)', 'EXECUTE'), 'authenticated não executa seed_default_categories');
SELECT ok(NOT has_function_privilege('authenticated', 'public.seed_default_financial_profiles(uuid)', 'EXECUTE'), 'authenticated não executa seed_default_financial_profiles');

SELECT ok(has_function_privilege('service_role', 'public.apply_transaction_classification_updates(jsonb)', 'EXECUTE'), 'service_role executa apply_transaction_classification_updates');
SELECT ok(has_function_privilege('service_role', 'public.check_classification_rate_limit(uuid, integer, integer, integer)', 'EXECUTE'), 'service_role executa check_classification_rate_limit');
SELECT ok(has_function_privilege('service_role', 'public.seed_default_categories(uuid)', 'EXECUTE'), 'service_role executa seed_default_categories');
SELECT ok(has_function_privilege('service_role', 'public.seed_default_financial_profiles(uuid)', 'EXECUTE'), 'service_role executa seed_default_financial_profiles');

-- E a chamada real, não só o catálogo:
SELECT set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
	$$SELECT public.seed_default_categories('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')$$,
	'42501',
	NULL,
	'authenticated recebe permission denied ao chamar RPC restrita'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
