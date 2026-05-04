# Planner

Personal finance planner built with SvelteKit and Supabase.

The app lets a household import card statements, classify transactions with categories/subcategories, review LLM suggestions, and improve personal classification rules over time.

## Stack

- SvelteKit
- Supabase Auth/Postgres/RLS
- Vercel adapter
- OpenAI or OpenRouter for transaction classification

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

3. Fill `.env` with your own Supabase and LLM credentials:

   ```bash
   PUBLIC_SUPABASE_URL=
   PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SECRET_KEY=
   SUPABASE_DB_URL=
   OPENAI_API_KEY=
   OPENROUTER_API_KEY=
   LLM_MODEL=
   ```

4. Create or link your Supabase project and apply migrations:

   ```bash
   npx supabase login
   npx supabase link --project-id <your-project-id>
   npx supabase db push
   ```

5. Start the development server:

   ```bash
   npm run dev
   ```

## Local Data

Do not commit real statements, exports, local `.env` files, Supabase CLI temp files, or logs. The repository includes only a small generic `gabarito-default.csv` used as a safe initial classification reference.

## License

MIT
