# Primeiros passos

Este guia parte de uma instância já no ar, seja na sua máquina ([setup-local.md](setup-local.md)) ou publicada ([deploy.md](deploy.md)), e vai da primeira conta até o primeiro mês classificado.

## 1. Conta e grupo

1. Na tela de login, crie a sua conta.
2. Em **Grupos**, clique em **Criar grupo**. O grupo, chamado de _household_ no código, é a casa: transações, categorias e regras pertencem a ele. Quem cria o grupo é o administrador.
3. As outras pessoas da casa criam as próprias contas, **sem criar um grupo**. Em seguida, você as adiciona em **Grupos → Adicionar membro**, com o e-mail de cada uma.

   Se alguém criou um grupo por engano antes de ser adicionado, o app continua mostrando o grupo mais antigo dessa pessoa. Nesse caso, remova a pessoa do grupo errado no Studio do Supabase (tabela `household_members`).

4. Numa instância publicada, depois que todos tiverem conta, [feche o cadastro](deploy.md#6-criar-as-contas-e-fechar-o-cadastro).

## 2. Nomes nas transferências

Em **Configurações → Nomes nas suas transferências**, escreva os nomes que aparecem quando você transfere dinheiro entre as suas próprias contas, um por linha. Inclua as formas abreviadas: um banco pode mostrar "Maria Silva" e outro cortar para "Maria S".

Com isso, um Pix da conta A para a conta B não conta duas vezes, como despesa numa e receita na outra.

## 3. Importar a primeira fatura

Em **Importar**:

1. Escolha a origem: **Cartão de crédito**, **Conta corrente**, **Vale alimentação** ou **Vale refeição**, e a conta (por exemplo "Nubank cartão"). Na primeira vez, você digita o nome; depois, ele aparece na lista.
2. Envie o arquivo. Os formatos aceitos são:
   - **CSV** exportado pelo banco. Os do Nubank e do Itaú são reconhecidos direto; outros formatos usam a IA para identificar as colunas.
   - **PDF** do extrato ou da fatura, ou **print** da tela do app do banco (exigem IA).
   - **Texto colado** (Ctrl+V na área de envio).
3. Confira a prévia e confirme.

Reimportar o mesmo arquivo não duplica nada: linhas iguais (data, descrição e valor no mesmo mês) são ignoradas. Na fatura de cartão, o pagamento da fatura anterior é descartado automaticamente.

Formatos de valor:

- **Cartão de crédito:** compras positivas, como no Nubank. O app inverte o sinal.
- **Conta corrente:** saídas já negativas.

## 4. Revisar

Depois da importação, cada transação é classificada por uma destas fontes, nesta ordem:

1. as suas **regras** (aprendidas ou criadas em **Regras**);
2. a **IA** (veja [llm.md](llm.md)), com as categorias do grupo como opções.

O que a IA classificou com pouca confiança vai para **Revisão** (o número no menu). Lá, ou em **Transações**, ajuste categoria e subcategoria. Cada correção vira uma regra pessoal, que ganha confiança a cada repetição; nas próximas faturas, aquele estabelecimento é classificado sem IA.

Em **Categorias**, você esconde as categorias padrão que não usa e cria as suas.

## 5. Despesas compartilhadas

Em **Grupos**, preencha a **renda mensal** de cada membro. Ao classificar uma transação, atribua-a ao perfil compartilhado e escolha a divisão:

- **Por renda** (padrão): cada pessoa paga proporcionalmente ao que ganha;
- **50/50**.

A tela mostra quem pagou o quê e o acerto final do mês, por exemplo "A paga R$ 120,00 para B". Despesas individuais ficam fora do acerto.

## 6. Parcelas

**Parcelas** projeta as prestações que ainda vão cair, lidas das marcações `1/6`, `Parcela 4/8` e semelhantes nas faturas importadas. Nada é gravado no futuro: quando a fatura real chega, a projeção se ajusta sozinha.

## 7. Investimentos (opcional)

O módulo lê as planilhas da [Área do Investidor da B3](https://www.investidor.b3.com.br).

1. Na B3, exporte em xlsx:
   - **Movimentação**: o arquivo principal, que vale importar todo mês;
   - **Posição**: de vez em quando, para conferir se a carteira bate;
   - **Negociação**: opcional, com o detalhe das compras e vendas.
2. Em **Investimentos → Importar**, envie os arquivos. O tipo é detectado sozinho e reenvios não duplicam.
3. **Renda fixa bancária (CDB, LCA, LCI):** a B3 não informa a taxa contratada. Na página **Investimentos**, preencha a **taxa de carrego** de cada título no quadro de mesmo nome (por exemplo, 95% do CDI), senão o rendimento não é calculado.
4. **Ativos que chegaram por transferência de corretora:** a movimentação não traz o custo de compra. Em **Investimentos → IR**, preencha o **Custo inicial manual** (quantidade e custo total na data de corte), senão o preço médio e o IR ficam errados.

As cotações são atualizadas automaticamente nos dias úteis pelo cron (veja [deploy.md](deploy.md#5-tarefas-agendadas-crons)). Também há um botão para atualizar na hora.
