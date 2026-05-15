# Planner

Personal finance planner built with SvelteKit and Supabase.

The app lets a household import card statements, classify transactions with categories/subcategories, review LLM suggestions, ignore non-expense statement payments, and improve personal classification rules over time.

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
   SUPABASE_SECRET_KEY=<service-role-secret-key>
   SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
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
3. Import a CSV credit card statement from **Importar fatura**.
4. Review classifications in **Transações**. Manual category/subcategory corrections are saved as personal rules and help classify future imports.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. Exposed to the browser. |
| `PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon public key. Exposed to the browser. |
| `SUPABASE_SECRET_KEY` | Yes | Supabase `service_role` key for server-side admin operations. It bypasses RLS; never expose publicly. |
| `SUPABASE_DB_URL` | Recommended | Direct Postgres connection string, useful for Supabase CLI/database workflows. |
| `OPENROUTER_API_KEY` | One LLM key required | Uses OpenRouter when set. |
| `OPENAI_API_KEY` | One LLM key required | Used only when `OPENROUTER_API_KEY` is empty. |
| `LLM_MODEL` | Recommended | Model id sent to the selected provider. |

## Useful Commands

```bash
npm run dev
npm run check
npm run build
npx supabase db push
```

## Local Data

Do not commit real statements, exports, local `.env` files, Supabase CLI temp files, or logs. The repository includes only generic seed/reference data that is safe to keep in Git.

## Deploy

See [DEPLOY.md](./DEPLOY.md).

## License

MIT
