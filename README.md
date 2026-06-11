# Planner

Personal finance planner built with SvelteKit and Supabase.

The app lets a household import credit card or bank account statements, classify transactions with categories/subcategories, review LLM suggestions, ignore non-expense statement payments, and improve personal classification rules over time. The dashboard at `/app` shows a category treemap (click a cell to drill down into its transactions), receitas-vs-despesas trend, and `/app/groups` shows who paid shared expenses, how they should be split, and the settlement amount one member needs to pay another.

## Security

This app holds real household financial data. Read [SECURITY.md](SECURITY.md) before contributing — it defines the threat model, the RLS/`SECURITY DEFINER` rules, the secrets policy, and the review checklist every change must pass.

## Stack

- SvelteKit
- Supabase Auth/Postgres/RLS
- Vercel adapter
- OpenAI or OpenRouter for transaction classification

## Requirements

- Node.js 20+
- npm
- Supabase project
- OpenRouter or OpenAI API key for automatic classification

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Create or choose a Supabase project, then copy these values into `.env`:

   ```bash
   PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
   PUBLIC_APP_URL=http://localhost:5173
   SUPABASE_SECRET_KEY=<service-role-secret-key>
   SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
   CRON_SECRET=<long-random-secret>
   ```

   You can find `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SECRET_KEY` in Supabase under **Project Settings -> API**. `SUPABASE_SECRET_KEY` must be the Supabase `service_role` key, is used only on the server, and bypasses RLS. Keep explicit `household_id` filters in server code even when RLS exists.

4. Link the Supabase CLI and apply the database migrations:

   ```bash
   npx supabase login
   npx supabase link --project-id <project-ref>
   npx supabase db push
   ```

5. Configure the LLM provider in `.env`.

   OpenRouter example:

   ```bash
   OPENROUTER_API_KEY=<openrouter-key>
   OPENAI_API_KEY=
   LLM_MODEL=xiaomi/mimo-v2.5-pro
   ```

   OpenAI example:

   ```bash
   OPENROUTER_API_KEY=
   OPENAI_API_KEY=<openai-key>
   LLM_MODEL=gpt-4o-mini
   ```

   If `OPENROUTER_API_KEY` is present, the app uses OpenRouter. Otherwise it uses OpenAI. `LLM_MODEL` must match the provider's model id.

6. Start the development server:

   ```bash
   npm run dev
   ```

7. Open the local URL printed by Vite, usually:

   ```text
   http://localhost:5173
   ```

## First User And Data

After applying migrations:

1. Create a user through the app login/signup flow, or directly in Supabase Auth.
2. Create or use a household/group in the app.
3. Import a CSV statement from **Importar fatura**. Pick **Cartão de crédito** (Nubank/Itaú-style files where charges are positive) or **Conta corrente** (charges already negative) — the parser flips signs accordingly and drops the bill-payment row when the description matches `pagamento`/`pagto`.
4. Add manual transactions from **Nova transação** when needed. The form is table-like, so you can fill several transactions and register the batch in one submit.
5. Review classifications in **Transações**. Manual category/subcategory corrections are saved as personal rules and increase confidence over repeated reinforcements, so future imports classify automatically once a merchant is confirmed enough times.
6. Use **Grupos** to maintain each member's monthly income, review shared expenses, choose whether each shared expense is split **Por renda** or **50/50**, and see the final settlement between members.

## Shared Expense Splitting

Shared expenses are transactions assigned to the household's shared financial profile. In `/app/groups`, each shared expense shows:

- who paid it (`paid_by_user_id`);
- whether it is split proportionally by monthly income or equally;
- each member's paid amount, expected share, and net balance;
- the simplified settlement transfer, for example "A paga R$ 120,00 para B".

The default split method is proportional to the monthly income stored on each `household_members` row. If all incomes are zero, proportional expenses fall back to an equal split. Individual/private expenses are not included in the shared settlement.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. Exposed to the browser. |
| `PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon public key. Exposed to the browser. |
| `PUBLIC_APP_URL` | Recommended | Public app origin used for OAuth/email redirects. Use the Vercel production URL online. |
| `SUPABASE_SECRET_KEY` | Yes | Supabase `service_role` key for server-side admin operations. It bypasses RLS; never expose publicly. |
| `SUPABASE_DB_URL` | Recommended | Direct Postgres connection string, useful for Supabase CLI/database workflows. |
| `CRON_SECRET` | Production cron only | Long random secret used by Vercel Cron to authorize `/api/health/supabase`. |
| `OPENROUTER_API_KEY` | One LLM key required | Uses OpenRouter when set. |
| `OPENAI_API_KEY` | One LLM key required | Used only when `OPENROUTER_API_KEY` is empty. |
| `LLM_MODEL` | Recommended | Model id sent to the selected provider. |

## Useful Commands

```bash
npm run dev
npm run check
npm test
npm run build
npx supabase db push
```

## Local Data

Do not commit real statements, exports, local `.env` files, Supabase CLI temp files, or logs. The repository includes only generic seed/reference data that is safe to keep in Git.

## Deploy

See [DEPLOY.md](./DEPLOY.md).

## License

MIT
