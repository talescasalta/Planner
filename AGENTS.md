# AGENTS.md

Instruções para agentes de IA que vão montar ou alterar uma instância do Planner. Os guias para pessoas estão em [`docs/`](docs/); este arquivo é o roteiro executável, com o que verificar em cada etapa e onde parar para pedir ajuda.

O app é uma aplicação SvelteKit 2 + Svelte 5 em português, com Supabase (Auth, Postgres, RLS) e deploy na Vercel. Requer Node 24 (`.nvmrc`; o `.npmrc` tem `engine-strict=true`).

## Regras que não mudam

- Nunca faça commit de `.env`, chaves, extratos, prints ou dados financeiros reais. Nos testes, use dados fictícios.
- `SUPABASE_SECRET_KEY` ignora o RLS: só no servidor e em variáveis de ambiente, nunca em código, log, variável `PUBLIC_*` ou mensagem para a pessoa.
- Migrations em `supabase/migrations/` são imutáveis depois de entrar na `main`. Para mudar o banco, crie uma migration nova com o próximo timestamp.
- Antes de propor uma mudança de código, rode `npm run quality`. É o mesmo gate da CI.
- Leia o [SECURITY.md](SECURITY.md) antes de tocar em autenticação, queries, RLS ou chamadas de LLM.

## Peça à pessoa (não faça sozinho)

Pare e peça quando chegar em qualquer um destes pontos:

1. **Contas e pagamentos:** criar contas no Supabase, na Vercel, na OpenRouter ou na OpenAI, e definir limite de gasto da LLM.
2. **Segredos que só ela tem:** a senha do banco do Supabase, a chave da LLM, um access token pessoal do Supabase (`sbp_...`) e o login das CLIs (`npx supabase login`, `npx vercel login`), que abre o navegador.
3. **Senhas de usuários do app:** cada pessoa cria a própria senha. Não invente nem anote senhas por ela.
4. **Login com Google:** exige criar um OAuth client no Google Cloud Console.

Peça uma coisa de cada vez, dizendo para que serve. Quando a pessoa colar um segredo, grave-o direto no `.env` ou na Vercel e não o repita.

## Setup local

Pré-requisito: Docker rodando (`docker info` sem erro).

```bash
npm install
npx supabase start
npx supabase status -o env
```

O `supabase start` aplica todas as migrations. O `status -o env` imprime as variáveis do Supabase local. Monte o `.env` a partir do `.env.example`:

| Variável do `.env`                | Valor                                                                                                                            |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_SUPABASE_URL`             | `API_URL`                                                                                                                        |
| `PUBLIC_SUPABASE_ANON_KEY`        | `PUBLISHABLE_KEY` ou, em CLIs antigas, `ANON_KEY`                                                                                |
| `SUPABASE_SECRET_KEY`             | `SECRET_KEY` ou, em CLIs antigas, `SERVICE_ROLE_KEY`                                                                             |
| `SUPABASE_DB_URL`                 | `DB_URL`                                                                                                                         |
| `PUBLIC_APP_URL`                  | `http://localhost:5173`                                                                                                          |
| `CRON_SECRET`                     | um valor aleatório, por exemplo `openssl rand -hex 32`                                                                           |
| `SIGNUP_ENABLED`                  | `true`                                                                                                                           |
| `OPENROUTER_API_KEY`, `LLM_MODEL` | da pessoa; opcional. Sem chave, a classificação por IA e a leitura de PDF e prints ficam desligadas ([docs/llm.md](docs/llm.md)) |

Depois, com `npm run dev` rodando em outro terminal:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:5173/api/health/supabase
```

O esperado é `{"ok":true,"service":"supabase","llm":{...}}`. `llm.provider: null` quer dizer que nenhuma chave de LLM foi configurada. Por fim, `npm run quality` deve passar.

O Supabase local não exige confirmação de e-mail, então a pessoa pode se cadastrar em `http://localhost:5173/login` e entrar logo em seguida.

## Instância publicada (Supabase + Vercel)

Prefira as CLIs aos painéis. O passo a passo para pessoas está em [docs/deploy.md](docs/deploy.md).

1. **Supabase.** Com a pessoa logada (`npx supabase login`), a senha do banco em mãos e o projeto já criado por ela:

   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   npx supabase projects api-keys --project-ref <ref>
   ```

   Verificação: `npx supabase db push --dry-run` responde `Remote database is up to date`.

2. **Vercel.** Com a pessoa logada (`npx vercel login`): rode `npx vercel link` e cadastre, com `npx vercel env add <NOME> production`, as variáveis da tabela do README:
   - `PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`), `PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SECRET_KEY`;
   - `PUBLIC_APP_URL`, `CRON_SECRET`, a chave da LLM e `LLM_MODEL`;
   - `SIGNUP_ENABLED=true` por enquanto.

   Cadastre tudo **antes** do primeiro deploy. As chaves do Supabase são lidas no build; se faltarem, o build falha com `"SUPABASE_SECRET_KEY" is not exported by "$env/static/private"` ou mensagem parecida. Em seguida, rode `npx vercel deploy --prod`.

3. **Auth do projeto.** Use a Management API com o access token da pessoa, em vez do painel:

   ```bash
   curl -s -X PATCH "https://api.supabase.com/v1/projects/<ref>/config/auth" \
     -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
     -d '{"site_url":"https://<app>.vercel.app","uri_allow_list":"https://<app>.vercel.app/**","mailer_autoconfirm":true}'
   ```

   `mailer_autoconfirm` dispensa a confirmação por e-mail. É necessário porque o e-mail padrão de um projeto Supabase só entrega para membros da equipe do projeto, com limite de poucos envios por hora: sem isso, o cadastro de quem não é da equipe fica preso esperando um e-mail que não chega. A alternativa é configurar um SMTP próprio (Resend, por exemplo) e deixar a confirmação ligada.

4. **Verificação.** Rode `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/health/supabase`. O esperado é `"ok":true` e `llm.modelExplicitlyConfigured: true`. Os dois crons do `vercel.json` são registrados sozinhos no deploy de produção; peça à pessoa para conferi-los em **Settings → Cron Jobs** na Vercel.

5. **Contas da casa.** Cada pessoa cria a própria conta em `/login`. Uma delas cria o grupo em **Grupos**, e as outras são adicionadas pelo e-mail, sem criarem grupos próprios ([docs/primeiro-uso.md](docs/primeiro-uso.md)).

6. **Fechar o cadastro.** Quando todos tiverem conta:
   - `PATCH .../config/auth` com `{"disable_signup":true}`, o que bloqueia também contas novas pelo Google;
   - `SIGNUP_ENABLED=false` na Vercel, seguido de redeploy.

   Verificação: `curl -s https://<ref>.supabase.co/auth/v1/settings -H "apikey: <anon>"` mostra `"disable_signup":true`, e `/login` não mostra mais "Cadastrar".

## Atualizar uma instância existente

```bash
git pull
npx supabase db push --dry-run
npx supabase db push
```

O `git pull` (ou o _Sync fork_ no GitHub) traz o código novo. O `--dry-run` lista as migrations pendentes; mostre essa lista à pessoa antes de aplicar. Aplique as migrations antes ou junto do deploy do código novo, porque ele pode depender das tabelas novas.

## Onde mexer

- Telas: `src/routes/app/**`. A vitrine `/dev/mobile?view=<view>` renderiza as telas sem login nem banco; use-a para verificar mudanças visuais.
- Regras de servidor: `src/lib/server/**`. Componentes: `src/lib/components/ui/`. Tokens de cor: `src/routes/layout.css`. Formatação: `src/lib/format.ts`.
- Mais convenções em [CONTRIBUTING.md](CONTRIBUTING.md).
