# Rodando o Planner na sua máquina

Este guia monta uma cópia completa do Planner no seu computador, com banco, login e e-mails locais. Leva uns 15 minutos. Não é preciso ter conta na Vercel nem projeto no Supabase em nuvem.

## Pré-requisitos

- **Node.js 24** ou mais novo. A versão está em [`.nvmrc`](../.nvmrc); com `nvm`, rode `nvm use`.
- **Docker Desktop** rodando. O Supabase local sobe em containers.
- **Git**.
- Uma chave da **OpenRouter** ou da **OpenAI**. É opcional para começar: sem ela, a importação de CSV e as regras funcionam, mas a classificação automática, a leitura de PDF e prints e os insights não. Veja [llm.md](llm.md).

## 1. Clonar e instalar

```bash
git clone https://github.com/talescasalta/Planner.git
cd Planner
npm install
```

## 2. Subir o Supabase local

```bash
npx supabase start
```

Na primeira vez, o download das imagens demora alguns minutos. O comando aplica todas as migrations de `supabase/migrations/` e, no fim, imprime algo como:

```text
API URL: http://127.0.0.1:54321
Studio URL: http://127.0.0.1:54323
Mailpit URL: http://127.0.0.1:54324
Publishable key: sb_publishable_...
Secret key: sb_secret_...
```

As versões mais antigas da CLI chamam essas chaves de `anon key` e `service_role key`. Se precisar ver os valores de novo, rode `npx supabase status`.

## 3. Criar o `.env`

```bash
cp .env.example .env
```

No Windows PowerShell, use `Copy-Item .env.example .env`.

Preencha com os valores do passo anterior:

```bash
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=<Publishable key ou anon key>
PUBLIC_APP_URL=http://localhost:5173
SUPABASE_SECRET_KEY=<Secret key ou service_role key>
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
CRON_SECRET=qualquer-texto-longo-para-dev
SIGNUP_ENABLED=true

OPENROUTER_API_KEY=<opcional>
LLM_MODEL=<opcional, veja docs/llm.md>
```

`SUPABASE_SECRET_KEY` ignora as regras de acesso do banco (RLS). Ela fica só no servidor e nunca deve ir para o Git. O `.env` já está no `.gitignore`.

## 4. Rodar o app

```bash
npm run dev
```

Abra <http://localhost:5173>, clique em **Não tem conta? Cadastrar** e crie um usuário. O Supabase local não exige confirmação por e-mail, então dá para entrar logo depois. Os e-mails que o app enviar, como os de recuperação de senha, aparecem no Mailpit (<http://127.0.0.1:54324>).

Para os próximos passos (criar o grupo, importar a primeira fatura, configurar nomes), siga [primeiro-uso.md](primeiro-uso.md).

## Vitrine de telas sem login

Em desenvolvimento, <http://localhost:5173/dev/mobile> mostra as telas principais com dados fictícios, sem precisar de login nem de banco. É útil para mexer no visual. Essa rota não existe em produção.

## Comandos do dia a dia

```bash
npm run dev               # servidor de desenvolvimento
npm test                  # testes unitários
npm run check             # checagem de tipos do Svelte/TypeScript
npm run quality           # tudo o que a CI roda: tipos, lint, formatação, cobertura, duplicação e migrations
npx supabase db reset     # recria o banco local do zero e reaplica as migrations
npx supabase stop         # desliga os containers
npm run test:rls          # testes de segurança do banco (pgTAP); exige o Supabase local rodando
```

O Studio do Supabase (<http://127.0.0.1:54323>) mostra as tabelas e os dados do banco local.

## Problemas comuns

**`port 54322 already allocated` ao rodar `supabase start`.** Outro projeto Supabase local está usando as mesmas portas. Desligue-o com `npx supabase stop --project-id <outro-projeto>` ou mude as portas em `supabase/config.toml`.

**O login redireciona para uma página que não abre.** Confira se `PUBLIC_APP_URL` é `http://localhost:5173`. Se você roda o Vite em outra porta, ajuste também `site_url` e `additional_redirect_urls` em `supabase/config.toml` e reinicie o Supabase.

**`npm run build` falha no Windows com erro de symlink.** Em builds locais no Windows, o projeto pula a saída específica da Vercel. Para forçá-la, rode com `FORCE_VERCEL_ADAPTER=1` num terminal com permissão para criar symlinks (modo desenvolvedor ou administrador). Na Vercel isso não é necessário.

**A classificação deixa tudo como "Revisar".** Provavelmente não há chave de LLM no `.env`, ou ela é inválida. Veja [llm.md](llm.md). O servidor registra o erro no terminal do `npm run dev`.
