# Segurança

Este projeto concentra dados financeiros reais da família. **Segurança tem prioridade sobre conveniência e velocidade de entrega.** Este documento define o modelo de ameaças, as regras inegociáveis e o checklist que toda mudança deve seguir.

## Modelo de ameaças

Dados protegidos: transações bancárias e de cartão, rendas, perfis financeiros e regras de classificação de cada _household_ (casal/grupo).

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
   a menos que ela tenha sido _desenhada_ para ser chamada pelo client e valide `auth.uid()` internamente.
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

### Secret scanning e push protection

- Secret scanning é fornecido pelo GitHub para este repositório público. Ele cobre service role/secret keys, chaves de LLM, `CRON_SECRET` e outros padrões de credenciais suportados.
- **Push protection deve permanecer habilitado** em [Settings → Code security and analysis](https://github.com/talescasalta/Planner/settings/security_analysis). Ele deve bloquear um push que contenha um segredo detectado antes de o commit chegar ao remoto.
- Se o push protection detectar um segredo real, interrompa o push, rotacione a credencial imediatamente e remova-a da árvore de trabalho e do histórico. Não ignore o bloqueio para fazer merge.

### LLM e privacidade

- Descrições, valores e datas de transações são enviados ao provedor configurado (OpenAI ou OpenRouter) para classificação. Use provedores/modelos com política de não-retenção e prefira contas com data training desativado.
- A chave de LLM nunca vai ao browser; chamadas só em `src/lib/server/llm.ts`.
- O endpoint `/api/classify` tem rate limit persistente por usuário (10 req/min) e teto de 200 ids por chamada — manter limites em endpoints novos que disparem LLM.

## Checklist de revisão para toda mudança

- [ ] Action/endpoint novo revalida sessão com `safeGetSession()` e retorna 401 sem usuário?
- [ ] Toda query de escrita é escopada por `household_id` (e `id`) — nunca só pelo `id`?
- [ ] Migration nova com `SECURITY DEFINER` faz REVOKE/GRANT explícito (regra acima)?
- [ ] Tabela nova tem RLS habilitado e policies escopadas por household (ou nenhuma policy, se for interna)?
- [ ] `npm run quality:migrations` passa e a migration aplicada não foi alterada ou removida?
- [ ] Uso de `supabaseAdmin` é precedido de checagem de autorização com o client do usuário?
- [ ] Nenhum segredo novo em código, log ou variável `PUBLIC_*`?
- [ ] Input externo (form, query string, CSV, resposta de LLM) é validado/limitado antes de usar?

## Rotina de manutenção

Periodicamente (e sempre após mudanças de schema):

1. **Supabase advisors**: rodar o lint de segurança (`get_advisors` via MCP, ou Dashboard → Advisors) e zerar os WARNs.
2. **Dependências**: `npm audit` e atualização de `@supabase/*`, SvelteKit e Vite quando houver patch de segurança.
3. **Testes**: `npm test` — os testes de `src/lib/server/security.test.ts` cobrem o escopo por household; adicione casos ao tocar em autorização.
4. **Revisar membros e sessões** no painel do Supabase Auth.

## Métricas e gates de CI

- A cobertura continua orientada por risco: não há aumento arbitrário de percentual como condição de merge.
- O gate de duplicação usa `jscpd` em `src`, com blocos de no mínimo 5 linhas e 50 tokens. O limite global é 4%; o baseline atual é aproximadamente 3,86% (o baseline medido anteriormente era 3,58%). O baseline TypeScript, atualmente aproximadamente 5,20% (medido anteriormente em 5,05%), é reportado separadamente e não bloqueia por linguagem nesta fase. Um novo clone relevante deve ser avaliado ou refatorado; o limite não será aumentado para acomodar código novo.
- O ESLint usa somente os conjuntos `recommended` não type-checked para JavaScript, TypeScript e Svelte, mantendo complexidade máxima modificada em 12. Os conjuntos type-checked ficam para uma fase posterior, depois da estabilização do gate básico.
- `npm run quality` executa type-check, lint (incluindo `scripts/*.mjs`), `format:check`, cobertura, duplicação e `quality:migrations`. A auditoria de dependências é separada porque roda em PR apenas quando `package.json` ou `package-lock.json` muda, além da execução semanal na `main`.
- `quality:migrations` verifica RLS em tabelas públicas, `SET search_path` e revogações de funções `SECURITY DEFINER`. Em PR, `quality:immutability` bloqueia alteração ou remoção de migrations que já existem na `main`; migrations novas são permitidas.
- Os workflows declaram `contents: read` no topo, usam actions fixadas por SHA e executam com Node 24 definido por `.nvmrc` e `package.json`.
- Vulnerabilidade alta ou crítica sem correção pode receber exceção temporária somente com análise de impacto, mitigação, justificativa e vencimento. A exceção só corresponde quando o ID do advisory aparece explicitamente no achado; pacote igual com advisory diferente ou ausente nunca é liberado por nome. O script falha quando a exceção está vencida; vulnerabilidades moderadas e baixas permanecem visíveis no relatório.
- O Dependency Review bloqueia novas vulnerabilidades altas/críticas em dependências de desenvolvimento e runtime; exige o Dependency graph habilitado em Settings → Code security and analysis. CodeQL usa o **default setup** do GitHub (não há workflow próprio no repositório), analisando JavaScript/TypeScript e os workflows do Actions em PRs e na `main`; o check `CodeQL` é o candidato a required check no ruleset. Scorecard publica SARIF semanalmente como informação, sem requisito agregado de merge.
- A duração do CI é observada pela métrica nativa do GitHub Actions. Depois de 20 PRs, será registrada a mediana e o p95; não há limite bloqueante inicial.

## Riscos aceitos

- **Advisory `GHSA-pxg6-pf52-xh8x` (low)** — quando retornado pelo registry, o mesmo advisory aparece em três nós do audit (`cookie`, `@sveltejs/kit` e `@sveltejs/adapter-vercel`). A exploração exige nome/path/domínio de cookie com caracteres fora dos limites; aqui os cookies são fixos e controlados pelo servidor (Supabase Auth). Não há exceção ativa: níveis baixos e moderados permanecem visíveis e não bloqueiam o gate. Reavaliar quando existir SvelteKit posterior a 2.69.2 com a correção upstream.

## Histórico de correções relevantes

- **2026-06-11** — `apply_transaction_classification_updates` (SECURITY DEFINER) era executável por `anon` e `authenticated` via REST e aceitava `household_id` nulo, permitindo a qualquer usuário autenticado alterar transações de qualquer household, contornando o RLS. Corrigido em `20260611120000_lock_down_classification_rpcs.sql` (REVOKE + `household_id` obrigatório) com o RPC movido para o client service-role no servidor. Na mesma data: sanitização do redirect `next` em `/auth/confirm`, CSP + cabeçalhos de segurança, senha mínima de 8 caracteres.
- **Migrations 010/011** — endurecimento das policies de RLS e movimentação dos helpers para o schema `private`, com REVOKE das funções públicas.
