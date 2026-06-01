# Deploy

## Pré-requisitos

- Conta Vercel
- Projeto Supabase
- Node.js 20+

## Variáveis de Ambiente

Configure na Vercel:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `PUBLIC_APP_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL`
- `CRON_SECRET`
- `OPENAI_API_KEY` ou `OPENROUTER_API_KEY`
- `LLM_MODEL`

O código atualmente lê exatamente `PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SECRET_KEY`, então use esses nomes na Vercel. `SUPABASE_SECRET_KEY` deve ser a chave `service_role`: ela bypassa RLS e precisa ficar restrita ao ambiente server-side. Mesmo com RLS, as rotas server-side devem manter filtros explícitos de `household_id`.

Configure `CRON_SECRET` como uma string longa e aleatória. A Vercel envia esse valor no header `Authorization` quando executar o cron diário de `/api/health/supabase`, que faz uma leitura leve no Supabase para verificar conectividade.

Configure `PUBLIC_APP_URL` com a URL pública de produção, por exemplo:

```bash
PUBLIC_APP_URL=https://planner-ebon-three.vercel.app
```

No Supabase Auth, adicione em **URL Configuration > Redirect URLs**:

```text
https://planner-ebon-three.vercel.app/auth/confirm
https://planner-ebon-three.vercel.app/auth/confirm?next=/app
https://planner-ebon-three.vercel.app/auth/confirm?next=/reset-password
```

E ajuste o **Site URL** para `https://planner-ebon-three.vercel.app`.

Exemplo com OpenRouter:

```bash
OPENROUTER_API_KEY=<openrouter-key>
OPENAI_API_KEY=
LLM_MODEL=xiaomi/mimo-v2.5-pro
```

## Banco de Dados

1. Crie um projeto no Supabase.
2. Aplique todas as migrations:
   ```bash
   npx supabase login
   npx supabase link --project-id <project-id>
   npx supabase db push
   ```
   Ou execute o SQL manualmente no SQL Editor do Supabase.

   O fluxo de divisão de despesas depende das colunas `household_members.monthly_income` e `transactions.split_method`, criadas pela migration `20260601213812_shared_expense_settlement.sql`. Se essas colunas não existirem, a tela `/app/groups` e o cadastro manual com regra de divisão não funcionarão corretamente.
3. Configure o Auth (Email provider habilitado).

## Deploy

```bash
npm run build
```

Em builds locais no Windows, o projeto pula a geração do output específico da Vercel para evitar falhas de symlink do `adapter-vercel`. Na Vercel, o adapter real é usado automaticamente porque a variável `VERCEL=1` é definida pelo ambiente. Para testar o output da Vercel localmente, rode com `FORCE_VERCEL_ADAPTER=1` em um terminal com permissão para criar symlinks.

Ou conecte o repositório Git na Vercel para deploy automático.

O arquivo `vercel.json` registra um Cron Job diário (`0 12 * * *`) para chamar `/api/health/supabase` em produção. Depois do deploy, confirme em **Project Settings > Cron Jobs** se o job foi registrado.

## Pós-deploy

1. Crie um usuário via `/login` (se signup estiver habilitado) ou diretamente no Supabase Auth.
2. Crie ou entre em um grupo/household no app.
3. Importe uma fatura CSV em `/app/imports`.
4. Revise as classificações em `/app/transactions`.
5. Em `/app/groups`, preencha a renda mensal dos membros, confirme que as despesas compartilhadas mostram quem pagou e valide o acerto final entre os membros.
