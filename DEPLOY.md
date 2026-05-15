# Deploy

## Pré-requisitos

- Conta Vercel
- Projeto Supabase
- Node.js 20+

## Variáveis de Ambiente

Configure na Vercel:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL`
- `OPENAI_API_KEY` ou `OPENROUTER_API_KEY`
- `LLM_MODEL`

O código atualmente lê exatamente `PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SECRET_KEY`, então use esses nomes na Vercel. `SUPABASE_SECRET_KEY` deve ser a chave `service_role`: ela bypassa RLS e precisa ficar restrita ao ambiente server-side. Mesmo com RLS, as rotas server-side devem manter filtros explícitos de `household_id`.

Exemplo com OpenRouter:

```bash
OPENROUTER_API_KEY=<openrouter-key>
OPENAI_API_KEY=
LLM_MODEL=xiaomi/mimo-v2.5-pro
```

## Banco de Dados

1. Crie um projeto no Supabase.
2. Aplique a migration inicial:
   ```bash
   npx supabase login
   npx supabase link --project-id <project-id>
   npx supabase db push
   ```
   Ou execute o SQL manualmente no SQL Editor do Supabase.
3. Configure o Auth (Email provider habilitado).

## Deploy

```bash
npm run build
```

Em builds locais no Windows, o projeto pula a geração do output específico da Vercel para evitar falhas de symlink do `adapter-vercel`. Na Vercel, o adapter real é usado automaticamente porque a variável `VERCEL=1` é definida pelo ambiente. Para testar o output da Vercel localmente, rode com `FORCE_VERCEL_ADAPTER=1` em um terminal com permissão para criar symlinks.

Ou conecte o repositório Git na Vercel para deploy automático.

## Pós-deploy

1. Crie um usuário via `/login` (se signup estiver habilitado) ou diretamente no Supabase Auth.
2. Crie ou entre em um grupo/household no app.
3. Importe uma fatura CSV em `/app/imports`.
4. Revise as classificações em `/app/transactions`.
