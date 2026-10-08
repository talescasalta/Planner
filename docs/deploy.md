# Publicando a sua instância (Supabase + Vercel)

> Vai pedir para um agente de IA fazer isso? Aponte-o para o [AGENTS.md](../AGENTS.md), que tem o mesmo roteiro por linha de comando.

Este guia coloca o Planner no ar, com banco no Supabase e app na Vercel. Os planos gratuitos das duas plataformas são suficientes para uso de uma casa.

Cada instância é independente: os seus dados ficam no **seu** projeto Supabase, e ninguém mais tem acesso a eles.

## 1. Fork do repositório

No GitHub, clique em **Fork**. Trabalhar no seu fork permite receber atualizações depois (veja [Atualizando](#atualizando)).

## 2. Projeto no Supabase

1. Crie uma conta em <https://supabase.com> e um projeto novo. Escolha a região **South America (São Paulo)** e guarde a senha do banco.
2. Na sua máquina, dentro do clone do fork, aplique as migrations:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   O `<project-ref>` é o trecho da URL do projeto: `https://supabase.com/dashboard/project/<project-ref>`.

3. Em **Project Settings → API Keys**, anote:
   - **Project URL**, que vira `PUBLIC_SUPABASE_URL`;
   - a chave **publishable** (ou `anon`), que vira `PUBLIC_SUPABASE_ANON_KEY`;
   - a chave **secret** (ou `service_role`), que vira `SUPABASE_SECRET_KEY`. Ela ignora o RLS: nunca a coloque no navegador nem no Git.
4. Em **Authentication → Sign In / Providers**, deixe **Email** habilitado.

## 3. Projeto na Vercel

1. Em <https://vercel.com>, clique em **Add New → Project** e importe o seu fork. O framework (SvelteKit) é detectado sozinho.
2. Antes do primeiro deploy, cadastre as variáveis em **Environment Variables**:

   | Variável                                 | Valor                                                                                                |
   | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
   | `PUBLIC_SUPABASE_URL`                    | Project URL do Supabase                                                                              |
   | `PUBLIC_SUPABASE_ANON_KEY`               | chave publishable/anon                                                                               |
   | `SUPABASE_SECRET_KEY`                    | chave secret/service_role                                                                            |
   | `PUBLIC_APP_URL`                         | a URL do app, por exemplo `https://<seu-app>.vercel.app` (dá para ajustar depois do primeiro deploy) |
   | `CRON_SECRET`                            | um texto aleatório longo, por exemplo gerado com `openssl rand -hex 32`                              |
   | `OPENROUTER_API_KEY` ou `OPENAI_API_KEY` | veja [llm.md](llm.md)                                                                                |
   | `LLM_MODEL`                              | veja [llm.md](llm.md)                                                                                |
   | `SIGNUP_ENABLED`                         | `true` por enquanto; veja o passo 6                                                                  |

   `SUPABASE_DB_URL` não é necessária na Vercel. Ela só é usada pela CLI do Supabase na sua máquina.

   As chaves do Supabase são lidas durante o build. Se faltar alguma, o deploy falha com uma mensagem como `"SUPABASE_SECRET_KEY" is not exported by "$env/static/private"`: cadastre a variável e faça um **Redeploy**.

3. Clique em **Deploy**. Quando terminar, copie a URL de produção e confira se `PUBLIC_APP_URL` está igual a ela. Se mudou, ajuste a variável e faça um **Redeploy**.

## 4. URLs de login no Supabase

Em **Authentication → URL Configuration**:

- **Site URL**: `https://<seu-app>.vercel.app`
- **Redirect URLs**: adicione `https://<seu-app>.vercel.app/**`

Sem isso, os links de confirmação de e-mail e de recuperação de senha voltam para o endereço errado.

### E-mail de confirmação

O e-mail padrão de um projeto Supabase só entrega mensagens para os membros da equipe do projeto, com limite de poucos envios por hora. Sem ajuste, quem se cadastra no app e não é da equipe espera por um e-mail de confirmação que nunca chega. Escolha uma saída:

- **Mais simples:** em **Authentication → Sign In / Providers → Email**, desligue **Confirm email**. Como o cadastro vai ser fechado no passo 6, o risco é pequeno.
- **Mais completa:** em **Authentication → Emails → SMTP Settings**, configure um SMTP próprio (o [Resend](https://resend.com) tem plano gratuito) e deixe a confirmação ligada. Isso também melhora os e-mails de recuperação de senha.

## 5. Tarefas agendadas (crons)

O [`vercel.json`](../vercel.json) registra dois crons, que a Vercel chama com o `CRON_SECRET`:

| Rota                          | Quando              | Para quê                                                                                                                         |
| ----------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health/supabase`        | todo dia, 12h UTC   | leitura leve que mantém o projeto Supabase gratuito ativo (ele pausa após uma semana sem uso) e mostra se a LLM está configurada |
| `/api/cron/investment-quotes` | dias úteis, 21h UTC | atualiza cotações (Yahoo Finance e Tesouro Transparente), CDI e cadastro de fundos; não precisa de chave                         |

Depois do deploy, confira em **Settings → Cron Jobs** se os dois aparecem.

## 6. Criar as contas e fechar o cadastro

1. Abra o app, cadastre a sua conta e crie o grupo da casa (veja [primeiro-uso.md](primeiro-uso.md)).
2. As outras pessoas da casa criam as contas delas, sem criar grupo, e você as adiciona em **Grupos → Adicionar membro**.
3. **Depois que todos tiverem conta, feche o cadastro.** Do contrário, qualquer pessoa que descobrir a URL pode criar uma conta e gastar os seus créditos de LLM. Os dados ficariam separados pelo RLS, mas a conta de LLM é sua.
   - No Supabase, em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up**. Isso bloqueia também contas novas pelo Google.
   - Na Vercel, mude `SIGNUP_ENABLED` para `false` e faça um redeploy. Isso esconde o botão "Cadastrar" na tela de login.

## Login com Google (opcional)

A tela de login tem o botão **Entrar com Google**. Para ele funcionar:

1. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crie um **OAuth client ID** do tipo _Web application_.
2. Em **Authorized redirect URIs**, adicione `https://<project-ref>.supabase.co/auth/v1/callback`.
3. No Supabase, em **Authentication → Sign In / Providers → Google**, habilite o provedor e cole o _Client ID_ e o _Client Secret_.

Se você não configurar o Google, o botão continua aparecendo, mas o login por ele falha. O login por e-mail e senha não é afetado.

## Atualizando

Para trazer as novidades do repositório original:

1. No GitHub, abra o seu fork e clique em **Sync fork**. A Vercel faz o deploy sozinha.
2. Se vieram migrations novas (arquivos novos em `supabase/migrations/`), aplique-as:

   ```bash
   git pull
   npx supabase db push
   ```

   Rode o `db push` logo depois do sync, porque o código novo pode depender das tabelas novas.

## Builds locais no Windows

Em builds locais no Windows, o projeto pula a saída específica da Vercel para evitar falhas de symlink do `adapter-vercel`. Na Vercel, o adapter real é usado automaticamente (a variável `VERCEL=1` é definida pela plataforma). Para testar a saída da Vercel localmente, rode com `FORCE_VERCEL_ADAPTER=1` num terminal com permissão para criar symlinks.
