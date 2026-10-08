# Contribuindo

Obrigado pelo interesse! O Planner é um projeto pessoal, mantido no tempo livre, mas issues e pull requests são bem-vindos.

## Antes de começar

- **Bug ou ideia:** abra uma [issue](../../issues/new/choose) antes de escrever código grande, para alinharmos o caminho.
- **Vulnerabilidade:** não abra uma issue pública. Siga o [SECURITY.md](SECURITY.md).
- **Dados reais:** nunca inclua extratos, prints, nomes, CPFs, números de conta ou qualquer dado financeiro de verdade em código, testes, issues ou PRs. Use valores fictícios ("Maria Silva", `•••.123.456-••`).

## Ambiente

Siga [docs/setup-local.md](docs/setup-local.md). Em resumo: Node 24, Docker, `npm install`, `npx supabase start`, `.env` e `npm run dev`.

## Fluxo

1. Faça um fork e crie uma branch a partir da `main`: `feat/...`, `fix/...` ou `docs/...`.
2. Faça mudanças pequenas e focadas, uma PR por assunto.
3. Antes de abrir a PR, rode:

   ```bash
   npm run quality
   ```

   É o mesmo gate da CI: tipos, lint, formatação, testes com cobertura, duplicação (jscpd) e checagem de migrations.

4. Abra a PR descrevendo o problema, a solução e como você testou. Para mudanças visuais, inclua prints, de preferência no celular e no desktop.

## Convenções

- **Idioma:** a interface é em português. Comentários e nomes no código, em inglês.
- **Svelte 5** com runes (`$props`, `$state`, `$derived`) e links com `resolve()` de `$app/paths`.
- **Visual:** use os tokens de cor de `src/routes/layout.css` (`text-income`, `text-expense`, `bg-surface` etc.) e os componentes de `src/lib/components/ui/` antes de criar novos.
- **Formatação** de dinheiro e datas: use `src/lib/format.ts`.
- **Commits** no estilo [Conventional Commits](https://www.conventionalcommits.org/pt-br/), em português: `feat: ...`, `fix: ...`, `docs: ...`.
- **Telas sem login:** a vitrine `/dev/mobile` renderiza as páginas com dados fictícios. Ao criar ou mudar uma tela, mantenha a view correspondente funcionando.

## Banco de dados

- **Migrations são imutáveis.** Depois que uma migration está na `main`, ela não pode ser editada nem removida (a CI bloqueia). Para mudar algo, crie uma migration nova com o próximo timestamp: `supabase/migrations/AAAAMMDDHHMMSS_descricao.sql`.
- Tabela nova precisa de RLS habilitado no mesmo arquivo. Função `SECURITY DEFINER` precisa de `SET search_path` e de `REVOKE`/`GRANT` explícitos.
- Ao mexer em policies ou RPCs, adicione asserções em `supabase/tests/` e rode `npm run test:rls`.

As regras completas e o checklist de revisão estão no [SECURITY.md](SECURITY.md).
