# Planner

Planejador de finanças da casa, feito com SvelteKit e Supabase. Importa faturas e extratos, classifica os gastos com regras aprendidas e IA, divide as despesas compartilhadas entre os membros e acompanha investimentos da B3.

> _Personal finance planner for Brazilian households (SvelteKit + Supabase). The app and its docs are in Portuguese._

É um projeto pessoal e aberto: qualquer pessoa pode montar a própria instância, com os dados no próprio projeto Supabase.

## O que ele faz

- **Importação** de faturas e extratos em CSV (Nubank e Itaú reconhecidos direto), PDF, print ou texto colado. Reimportar não duplica.
- **Classificação** por regras pessoais, que aprendem com cada correção, e por IA para o resto. Uma fila de revisão mostra o que precisa de confirmação.
- **Visão geral do mês:** despesas, receitas, taxa de poupança, projeção do mês, gastos fora do normal, treemap de categorias com detalhamento e insights gerados por IA.
- **Grupos:** quem pagou o quê, divisão por renda ou 50/50 e o acerto final entre os membros.
- **Parcelas:** projeção das prestações futuras a partir das marcações `k/n` das faturas.
- **Investimentos:** importação das planilhas da Área do Investidor da B3, cotações diárias, rendimento por período comparado ao CDI, renda fixa bancária pela taxa contratada e apuração de IR.
- Funciona no celular, com modo escuro automático.

## Começando

| Quero...                                        | Guia                                         |
| ----------------------------------------------- | -------------------------------------------- |
| rodar na minha máquina                          | [docs/setup-local.md](docs/setup-local.md)   |
| publicar a minha instância (Supabase + Vercel)  | [docs/deploy.md](docs/deploy.md)             |
| configurar a IA e entender custos e privacidade | [docs/llm.md](docs/llm.md)                   |
| usar o app depois de instalado                  | [docs/primeiro-uso.md](docs/primeiro-uso.md) |
| pedir para um agente de IA montar tudo          | [AGENTS.md](AGENTS.md)                       |

Resumo para quem já conhece a stack:

```bash
npm install
npx supabase start        # precisa do Docker
cp .env.example .env      # preencha com a saída do supabase start
npm run dev
```

## Stack

- [SvelteKit](https://svelte.dev) (Svelte 5) e Tailwind CSS 4
- [Supabase](https://supabase.com): Auth, Postgres e RLS
- [Vercel](https://vercel.com) para hospedagem e crons
- OpenRouter ou OpenAI para classificação e leitura de documentos

## Variáveis de ambiente

| Variável                                 | Obrigatória  | Descrição                                                                    |
| ---------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `PUBLIC_SUPABASE_URL`                    | sim          | URL do projeto Supabase. Vai para o navegador.                               |
| `PUBLIC_SUPABASE_ANON_KEY`               | sim          | Chave publishable/anon do Supabase. Vai para o navegador.                    |
| `SUPABASE_SECRET_KEY`                    | sim          | Chave secret/service_role. Ignora o RLS: só no servidor, nunca no Git.       |
| `PUBLIC_APP_URL`                         | recomendada  | URL pública do app, usada nos links de e-mail e no retorno do login.         |
| `CRON_SECRET`                            | em produção  | Segredo que a Vercel envia aos crons.                                        |
| `OPENROUTER_API_KEY` ou `OPENAI_API_KEY` | para usar IA | Se as duas existirem, vale a OpenRouter. Veja [docs/llm.md](docs/llm.md).    |
| `LLM_MODEL`                              | recomendada  | Modelo enviado ao provedor. Padrão: `gpt-4o-mini`.                           |
| `SIGNUP_ENABLED`                         | não          | `false` esconde e recusa o cadastro de novas contas. Padrão: `true`.         |
| `SUPABASE_DB_URL`                        | não          | Conexão direta ao Postgres, usada pela CLI do Supabase e por scripts locais. |

## Segurança

O app guarda dados financeiros reais. Antes de contribuir, leia o [SECURITY.md](SECURITY.md): ele define o modelo de ameaças, as regras de RLS e de `SECURITY DEFINER`, a política de segredos e o checklist de revisão.

Nunca faça commit de extratos reais, exportações, arquivos `.env` ou logs. O repositório só contém dados fictícios e uma taxonomia de categorias genérica.

## Contribuindo

Veja o [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE)
