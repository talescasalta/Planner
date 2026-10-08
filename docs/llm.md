# Classificação com IA (LLM)

O Planner usa um modelo de linguagem para as tarefas que regras fixas não resolvem bem. A chave é sua: você escolhe o provedor e paga diretamente a ele.

## Onde a IA é usada

| Recurso                                                     | Sem chave de LLM                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classificar transações que nenhuma regra pessoal reconheceu | As transações entram como **Revisar** e você classifica à mão. Cada correção vira regra e, com o tempo, a IA deixa de ser chamada para aquele estabelecimento. |
| Ler extratos em PDF, prints de fatura e texto colado        | Não funciona; use CSV.                                                                                                                                         |
| Mapear colunas de um CSV com cabeçalho desconhecido         | CSVs com colunas conhecidas (`data`/`date`, `descrição`/`histórico`/`lançamento`, `valor`/`amount`) funcionam; outros formatos falham.                         |
| Insights do mês, no dashboard                               | Botão indisponível.                                                                                                                                            |
| Ler prints de fundos e o assistente de investimentos        | Não funcionam. O restante do módulo de investimentos (B3, cotações, IR) funciona.                                                                              |

Ou seja, o app funciona sem IA, mas dá mais trabalho no começo.

## Configuração

Escolha **um** provedor. Se as duas chaves estiverem preenchidas, vale a OpenRouter.

**OpenRouter** (recomendado, porque dá acesso a vários modelos com uma chave só):

```bash
OPENROUTER_API_KEY=sk-or-...
OPENAI_API_KEY=
LLM_MODEL=openai/gpt-4o-mini
```

Crie a chave em <https://openrouter.ai/keys>. Na OpenRouter, `LLM_MODEL` usa o formato `fornecedor/modelo`, como aparece no catálogo do site.

**OpenAI:**

```bash
OPENROUTER_API_KEY=
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
```

Sem `LLM_MODEL`, o app usa `gpt-4o-mini`. A rota `/api/health/supabase` informa qual modelo está ativo e se ele foi configurado explicitamente.

### Que modelo escolher

A tarefa é simples: ler descrições curtas de transações e escolher uma categoria de uma lista. Modelos pequenos e baratos dão conta. Para ler PDFs e prints, o modelo precisa aceitar imagens.

Comece com um modelo barato. Se as sugestões errarem muito, teste um maior.

## Custos

As transações vão para o modelo em lotes de 30, e cada chamada gera no máximo 500 tokens de resposta. Uma fatura típica, com 50 a 150 lançamentos, faz poucas chamadas. Com modelos da faixa do `gpt-4o-mini`, isso custa centavos por mês.

A cada fatura, a conta cai, porque as regras aprendidas classificam os estabelecimentos conhecidos sem chamar a IA.

Para não ter surpresas:

- defina um **limite de gasto** no painel do provedor;
- feche o cadastro de novas contas depois de criar as da casa (veja [deploy.md](deploy.md#6-criar-as-contas-e-fechar-o-cadastro)).

O app também limita cada usuário a 10 chamadas de IA por minuto.

## O que é enviado ao provedor

- **Classificação:** descrição, estabelecimento, valor, data e a lista das suas categorias. Nas transferências Pix do Nubank, a descrição vai só com o nome da outra parte, sem CPF, agência e conta.
- **CSV com cabeçalho desconhecido:** os nomes das colunas e as 8 primeiras linhas, cada campo cortado em 120 caracteres.
- **Leitura de PDF, print ou texto colado:** o conteúdo do arquivo, que pode trazer dados do extrato.
- **Insights e assistente de investimentos:** totais agregados do mês ou da carteira.

Nunca são enviados senhas, chaves ou o seu e-mail. Mesmo assim, as descrições saem do seu ambiente. Prefira provedores e contas com retenção zero e sem uso dos dados para treino. Detalhes na seção "LLM e privacidade" do [SECURITY.md](../SECURITY.md).
