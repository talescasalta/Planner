# Deploy

## Pré-requisitos

- Conta Vercel
- Projeto Supabase
- Node.js 20+

## Variáveis de Ambiente

Configure na Vercel:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ou legacy `PUBLIC_SUPABASE_ANON_KEY`)
- `SUPABASE_SECRET_KEY` (ou legacy `SUPABASE_SERVICE_ROLE_KEY`)
- `SUPABASE_DB_URL`
- `OPENAI_API_KEY` ou `OPENROUTER_API_KEY`

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
2. Crie uma household manualmente e adicione o usuário em `household_members`.
3. Execute as funções de seed:
   ```sql
   SELECT seed_default_categories('<household_id>');
   SELECT seed_default_financial_profiles('<household_id>');
   ```
4. Atualize `financial_profiles` vinculando `user_id` dos perfis individuais aos usuários correspondentes.
