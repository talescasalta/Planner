# Segurança

Este projeto concentra dados financeiros reais da família. **Segurança tem prioridade sobre conveniência e velocidade de entrega.** Este documento define o modelo de ameaças, as regras inegociáveis e o checklist que toda mudança deve seguir.

## Modelo de ameaças

Dados protegidos: transações bancárias e de cartão, rendas, perfis financeiros e regras de classificação de cada *household* (casal/grupo).

Principais riscos, em ordem de impacto:

1. **Vazamento entre households** — um usuário autenticado lendo ou alterando dados de outro grupo.
2. **Acesso anônimo** — endpoints REST/RPC do Supabase acessíveis sem login.
3. **Vazamento de segredos** — service role key, chaves de LLM ou dumps de dados commitados no Git.
4. **Comprometimento de conta** — senha fraca/vazada de um dos dois usuários.
5. **Exfiltração via terceiros** — descrições de transações enviadas a provedores de LLM.

## Arquitetura de segurança

### RLS é a fronteira de autorização

- Toda tabela em `public` tem RLS habilitado. Tabelas internas (ex.: `classification_rate_limits`) ficam **sem policy nenhuma** de propósito: negação total, acesso só via service role.
- O escopo padrão de toda policy é o household, via os helpers do schema `private` (`private.is_member_of_household`, `private.user_can_edit_transaction`, etc. — ver `supabase/migrations/011_private_rls_helpers.sql`).
- Helpers de RLS vivem no schema `private`, nunca no `public` exposto pela API REST.

### Regras para `SECURITY DEFINER` e service role

Funções `SECURITY DEFINER` no schema `public` são expostas em `/rest/v1/rpc/*` e **por padrão o Postgres concede EXECUTE a PUBLIC**. Isso já causou uma vulnerabilidade real aqui (ver histórico). Regras:

1. Toda função `SECURITY DEFINER` nova **deve** terminar com:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.minha_funcao(...) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.minha_funcao(...) FROM anon, authenticated;
   GRANT EXECUTE ON FUNCTION public.minha_funcao(...) TO service_role;
   ```
   a menos que ela tenha sido *desenhada* para ser chamada pelo client e valide `auth.uid()` internamente.
2. Sempre `SET search_path = public` (ou `public, private`).
3. O client admin (`supabaseAdmin`, em `src/lib/server/supabase.ts`) ignora RLS. Antes de qualquer uso dele, o código do servidor **deve** validar a autorização com o client do usuário (RLS-enforced) — ver o padrão em `src/routes/app/groups/+page.server.ts` (`add_member`) e `src/lib/server/classifier/index.ts` (`runUpdates`).
4. `supabaseAdmin` nunca pode ser importado em código que roda no browser (só dentro de `src/lib/server/` e arquivos `+*.server.ts` / `+server.ts`).

### Autenticação e sessão

- Identidade no servidor vem **somente** de `safeGetSession()` (que usa `auth.getUser()`, validando o JWT no servidor). Nunca confiar em `getSession()`/cookies sem verificação.
- O guard do layout `/app` não protege actions: **toda action e todo endpoint revalidam a sessão individualmente**. Manter esse padrão em rotas novas.
- Senhas: mínimo de 8 caracteres validado no servidor. No painel do Supabase (Auth → Policies) devem estar ativos:
  - **Leaked password protection** (HaveIBeenPwned) — apontado pelo advisor;
  - Minimum password length ≥ 8.
- Redirects pós-login: o parâmetro `next` em `/auth/confirm` só aceita caminhos internos (`/...`), nunca URLs absolutas ou `//host`.

### Cabeçalhos HTTP e CSP

- CSP é gerada pelo SvelteKit (`svelte.config.js`, `kit.csp`). Ao adicionar um domínio externo (CDN, API, fonte), adicione-o explicitamente à diretiva correspondente — não afrouxe `default-src`.
- Os demais cabeçalhos (`X-Frame-Options`, `HSTS`, `Referrer-Policy`, etc.) são definidos em `src/hooks.server.ts`.

### Segredos e dados locais

- `.env` está no `.gitignore` e **nunca** entra no Git. Variáveis novas entram no `.env.example` sem valor.
- `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`/`OPENROUTER_API_KEY` e `CRON_SECRET` são exclusivamente server-side (`$env/static/private` / `$env/dynamic/private`). Nada sensível em variáveis `PUBLIC_*`.
- Exports bancários (`*.csv`) são ignorados pelo Git, exceto o gabarito de categorias. Mesmo assim, evite deixar CSVs reais na raiz do repositório — apague após importar.
- Se um segredo vazar (commit acidental, log, print): **rotacione imediatamente** no painel do Supabase/provedor; remover do histórico do Git não é suficiente.

### LLM e privacidade

- Descrições, valores e datas de transações são enviados ao provedor configurado (OpenAI ou OpenRouter) para classificação. Use provedores/modelos com política de não-retenção e prefira contas com data training desativado.
- A chave de LLM nunca vai ao browser; chamadas só em `src/lib/server/llm.ts`.
- O endpoint `/api/classify` tem rate limit persistente por usuário (10 req/min) e teto de 200 ids por chamada — manter limites em endpoints novos que disparem LLM.

## Checklist de revisão para toda mudança

- [ ] Action/endpoint novo revalida sessão com `safeGetSession()` e retorna 401 sem usuário?
- [ ] Toda query de escrita é escopada por `household_id` (e `id`) — nunca só pelo `id`?
- [ ] Migration nova com `SECURITY DEFINER` faz REVOKE/GRANT explícito (regra acima)?
- [ ] Tabela nova tem RLS habilitado e policies escopadas por household (ou nenhuma policy, se for interna)?
- [ ] Uso de `supabaseAdmin` é precedido de checagem de autorização com o client do usuário?
- [ ] Nenhum segredo novo em código, log ou variável `PUBLIC_*`?
- [ ] Input externo (form, query string, CSV, resposta de LLM) é validado/limitado antes de usar?

## Rotina de manutenção

Periodicamente (e sempre após mudanças de schema):

1. **Supabase advisors**: rodar o lint de segurança (`get_advisors` via MCP, ou Dashboard → Advisors) e zerar os WARNs.
2. **Dependências**: `npm audit` e atualização de `@supabase/*`, SvelteKit e Vite quando houver patch de segurança.
3. **Testes**: `npm test` — os testes de `src/lib/server/security.test.ts` cobrem o escopo por household; adicione casos ao tocar em autorização.
4. **Revisar membros e sessões** no painel do Supabase Auth.

## Riscos aceitos

- **`cookie@0.6.0` (low) via `@sveltejs/kit`** — advisory GHSA-pxg6-pf52-xh8x exige nome/path/domínio de cookie controlado pelo usuário; aqui os cookies são fixos (Supabase Auth). Sem correção upstream até o Kit 2.65.0. Reavaliar a cada atualização do SvelteKit.

## Histórico de correções relevantes

- **2026-06-11** — `apply_transaction_classification_updates` (SECURITY DEFINER) era executável por `anon` e `authenticated` via REST e aceitava `household_id` nulo, permitindo a qualquer usuário autenticado alterar transações de qualquer household, contornando o RLS. Corrigido em `20260611120000_lock_down_classification_rpcs.sql` (REVOKE + `household_id` obrigatório) com o RPC movido para o client service-role no servidor. Na mesma data: sanitização do redirect `next` em `/auth/confirm`, CSP + cabeçalhos de segurança, senha mínima de 8 caracteres.
- **Migrations 010/011** — endurecimento das policies de RLS e movimentação dos helpers para o schema `private`, com REVOKE das funções públicas.
