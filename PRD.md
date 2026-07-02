# PRD - Planner

## 1. Resumo do Produto

Planner e um app web open source para importar, classificar, revisar e analisar gastos pessoais e compartilhados de um grupo familiar.

O caso inicial e um casal, mas o produto deve usar o conceito de `household`/grupo para permitir evolucao futura para outros arranjos. Cada usuario entra com sua propria conta, ve apenas transacoes autorizadas e pode colaborar nas despesas compartilhadas do grupo.

O app usa regras deterministicas, gabarito pessoal e LLM para sugerir categoria, subcategoria e atribuicao de gastos. A LLM deve receber apenas dados minimizados e anonimizados, nunca arquivos brutos, segredos, dados bancarios completos ou identificadores pessoais desnecessarios.

## 2. Distribuicao Open Source

O projeto deve ser publicado como repositorio publico no GitHub sob licenca MIT.

Objetivos de distribuicao:

- qualquer pessoa pode clonar, fazer fork, criar branch e abrir PR;
- apenas mantenedores com permissao no repositorio podem fazer merge;
- a branch principal deve ser `main`;
- o repositorio nao deve conter dados reais de fatura, `.env`, tokens, chaves, arquivos temporarios de CLI ou vinculos locais do Supabase;
- cada pessoa deve poder configurar seu proprio `.env`, conectar ao seu proprio projeto Supabase e aplicar as migrations.

Arquivos esperados:

- `README.md` com setup local;
- `.env.example` sem valores reais;
- `LICENSE` com MIT;
- migrations do Supabase;
- gabarito inicial generico e seguro, sem dados pessoais.

## 3. Objetivo Principal

Construir um app SvelteKit seguro e manutenivel que permita:

- importar transacoes por CSV;
- adicionar transacoes manualmente;
- pre-classificar gastos com regras pessoais e LLM;
- classificar por categoria e subcategoria;
- atribuir gastos ao grupo ou a membros individuais;
- distinguir quem pagou de quem e dono do gasto;
- dividir despesas compartilhadas proporcionalmente a renda mensal ou 50/50;
- calcular o acerto necessario entre membros para despesas em comum;
- revisar e corrigir classificacoes;
- aprender automaticamente com ajustes manuais do usuario;
- filtrar transacoes por mes da fatura;
- apagar transacoes individualmente, em lote ou por mes;
- visualizar relatorios mensais por pessoa, grupo, categoria, pagador e status.

## 4. Nao Objetivos

A primeira versao nao deve tentar ser uma plataforma financeira completa.

Fora do escopo inicial:

- integracoes bancarias;
- Open Finance;
- scraping automatico de bancos/cartoes;
- investimentos;
- pagamento de contas;
- previsao de orcamento;
- app mobile nativo;
- SaaS multi-tenant com billing;
- cadastro publico irrestrito para desconhecidos;
- motor contábil complexo de reembolso;
- OCR/PDF parsing, salvo se solicitado depois.

## 5. Stack Tecnica

Usar:

- SvelteKit;
- TypeScript;
- Supabase Auth;
- Supabase Postgres;
- Supabase Row Level Security;
- Supabase CLI para migrations;
- Tailwind CSS;
- Vercel para deploy;
- OpenAI ou OpenRouter via codigo server-side.

Regras de arquitetura:

- paginas sensiveis carregam dados pelo servidor;
- service role nunca aparece no cliente;
- RLS e a barreira final de seguranca;
- regras deterministicas e pessoais rodam antes da LLM;
- a LLM nunca decide permissao de banco;
- migrations devem permitir que outro usuario suba seu proprio Supabase do zero.

## 6. Conceitos Principais

### 6.1 User

Pessoa autenticada no app.

Cada usuario tem sessao propria e perfil de exibicao.

### 6.2 Household

Grupo financeiro compartilhado.

O nome do household deve aparecer na UI como a opcao compartilhada de atribuicao. O app nao deve depender do texto fixo "Casal".

### 6.3 Household Member

Vincula usuario a household.

Campos importantes:

- `user_id`;
- `household_id`;
- `role`;
- `monthly_income`.

Roles esperados:

- `admin`;
- `member`.

Somente admin pode administrar membros do grupo.

`monthly_income` e informado manualmente na tela de grupo e usado para calcular a divisao proporcional das despesas compartilhadas. Se todas as rendas estiverem zeradas, a divisao proporcional deve cair para uma divisao igual entre membros.

### 6.4 Financial Profile

Representa quem e dono economico do gasto.

Tipos:

- `shared`: perfil compartilhado do household, exibido com o nome real do grupo;
- `individual`: perfil individual vinculado a um usuario.

Perfis individuais sem `user_id` nao devem aparecer em telas novas de atribuicao.

### 6.5 Transaction

Registro financeiro importado ou criado manualmente.

Campos funcionais:

- data da compra;
- mes da fatura (`reference_month`);
- descricao;
- merchant limpo;
- valor;
- moeda;
- fonte/cartao;
- quem pagou;
- a quem o gasto foi atribuido;
- regra de divisao para despesas compartilhadas;
- categoria;
- subcategoria;
- metodo de classificacao;
- status de revisao;
- sugestao de classificacao.

### 6.6 Transaction Access

Controle explicito de quem pode ler ou editar uma transacao.

Nao confiar apenas em `owner_profile_id`.

Regras:

- usuario so le transacoes com `can_read = true`;
- usuario so edita/apaga transacoes com `can_edit = true`;
- despesas compartilhadas devem gerar acesso para membros permitidos;
- despesas privadas devem ficar visiveis apenas para usuarios autorizados.

### 6.7 Category e Subcategory

Categorias sao hierarquicas:

- categoria: linha pai;
- subcategoria: linha filha com `parent_id`.

O subgrupo sempre pertence a um grupo especifico. Exemplo: `Doces e Sorvetes` deve aparecer apenas quando a categoria for `Alimentacao`, nao em `Transporte`.

Categorias oficiais sao sugestoes, nao fixas. O usuario pode:

- criar categoria;
- criar subcategoria;
- ocultar/excluir categoria sugerida;
- ocultar/excluir subcategoria sugerida;
- manter um gabarito pessoal retroalimentado.

Categorias ja usadas por transacoes devem continuar aparecendo como texto e opcoes validas da transacao, mesmo se foram ocultadas do gabarito.

### 6.8 Gabarito

Existem dois niveis de gabarito:

- gabarito oficial generico: taxonomia inicial segura, versionada no repo;
- gabarito pessoal: preferencias do usuario aprendidas a partir de ajustes manuais.

O repositorio publico nao deve conter faturas reais ou um gabarito derivado de dados pessoais. CSVs reais devem ficar ignorados pelo Git.

### 6.9 Classification Rule

Regra reutilizavel criada manualmente ou aprendida a partir de ajustes confirmados.

Uma regra pessoal pode conter:

- padrao;
- tipo de padrao;
- categoria;
- subcategoria;
- perfil de atribuicao;
- usuario criador;
- confianca;
- status ativo.

Regras pessoais do usuario devem ser aplicadas antes da LLM.

### 6.10 Classification Suggestion

Sugestao gerada por regra ou LLM.

Deve conter:

- categoria;
- subcategoria;
- perfil sugerido;
- confianca;
- `needs_review`;
- motivo/codigo explicativo quando possivel.

Se a LLM retornar nomes que nao mapeiam para IDs validos do household, a transacao deve ficar em revisao e a UI pode mostrar a sugestao como texto, mas nao deve gravar IDs invalidos.

## 7. User Stories

### 7.1 Autenticacao

Como usuario, quero entrar com minhas proprias credenciais para proteger meus gastos privados.

Criterios:

- usuarios nao autenticados nao acessam `/app`;
- cada usuario tem sessao separada;
- usuario consegue solicitar recuperacao de senha por email;
- link de recuperacao permite definir uma nova senha;
- dados sensiveis carregam server-side;
- login funciona em producao na Vercel.

### 7.2 Importar Fatura

Como usuario, quero subir um CSV para nao cadastrar todos os gastos manualmente.

Criterios:

- usuario informa o mes da fatura;
- importacao grava `reference_month`;
- linhas sao normalizadas;
- duplicidade basica deve ser considerada;
- raw file nao deve ser logado;
- raw file nao deve ser armazenado permanentemente sem necessidade;
- apos upload, o sistema pre-classifica usando regras pessoais e LLM.

### 7.3 Entrada Manual

Como usuario, quero cadastrar uma transacao manualmente.

Criterios:

- campos de data, descricao, valor, pagador, atribuicao, categoria e subcategoria;
- validacao de IDs contra o household;
- cadastro em lote com varias linhas antes de registrar;
- linhas totalmente vazias sao ignoradas;
- usuario pode informar pagador, atribuicao e regra de divisao por linha;
- acesso criado conforme regra de privacidade;
- ajuste manual alimenta aprendizado pessoal.

### 7.4 Classificacao de Gastos

Como usuario, quero que o sistema classifique gastos automaticamente.

Criterios:

- regras pessoais rodam antes da LLM;
- LLM recebe categorias/subcategorias permitidas;
- LLM recebe exemplos pessoais e gabarito oficial quando util;
- LLM nao deve chutar atribuicao quando nao houver regra pessoal confiavel;
- baixa confianca marca `needs_review`;
- sugestoes sem ID valido aparecem como sugestao visual, nao como classificacao confirmada.

### 7.5 Ajuste Manual e Aprendizado

Como usuario, quero corrigir uma classificacao e fazer o app aprender minha preferencia.

Criterios:

- salvar ajuste atualiza transacao;
- `review_status` vira `confirmed`;
- regra pessoal e criada ou atualizada;
- regra pessoal inclui categoria, subcategoria e atribuicao;
- proximas transacoes similares usam a regra antes da LLM.

### 7.6 Aba Transacoes

Como usuario, quero ler e ajustar gastos rapidamente sem uma listona confusa.

Criterios:

- seletor de mes da fatura no topo;
- opcao "Todos os meses";
- filtros por origem (cartao de credito / conta corrente), categoria, subcategoria e status de revisao;
- busca textual e ordenacao por valor sobre o mes carregado;
- sem query, selecionar automaticamente o mes mais recente;
- resumo do filtro: quantidade, despesas, creditos e saldo;
- tabela mostra apenas o mes selecionado;
- paginacao aplicada dentro do filtro;
- cada linha mostra dropdowns compactos sempre visiveis de categoria, subcategoria e atribuicao, estilo planilha;
- alterar qualquer dropdown salva a linha imediatamente (auto-save), sem abrir editor nem botao de salvar;
- a subcategoria depende da categoria da linha e permite "criar nova" inline;
- trocar categoria limpa subcategoria invalida antes de salvar;
- se existir ID salvo, os dropdowns mostram categoria/subcategoria salvas;
- se nao existir ID mas houver `classification_suggestion`, mostrar a sugestao como texto auxiliar ("sugerido");
- se nao houver nada, mostrar "Sem categoria";
- selecionar varias linhas permite aplicar a mesma categoria/subcategoria/atribuicao em lote num unico submit.

### 7.7 Excluir Transacoes

Como usuario, quero apagar transacoes importadas incorretamente.

Criterios:

- apagar transacao individual;
- selecionar transacoes visiveis e apagar em lote;
- apagar mes da fatura inteiro;
- somente transacoes com `transaction_access.can_edit = true` podem ser apagadas;
- exclusao e hard delete em `transactions`;
- `transaction_access` deve cair por cascade.

### 7.8 Review Queue

Como usuario, quero revisar transacoes incertas.

Criterios:

- `/app/review` mostra `needs_review`;
- usuario corrige categoria, subcategoria e atribuicao;
- confirmacao alimenta regra pessoal;
- transacao confirmada sai da fila.

### 7.9 Gerenciar Categorias

Como usuario, quero personalizar meu gabarito.

Criterios:

- criar categoria;
- criar subcategoria vinculada a categoria;
- ocultar/excluir categoria sugerida;
- ocultar/excluir subcategoria sugerida;
- nao quebrar transacoes historicas que usam categoria oculta;
- categorias pessoais entram no prompt da LLM.

### 7.10 Grupos

Como admin, quero gerenciar membros do grupo.

Criterios:

- somente `role = admin` adiciona ou remove membros;
- membro comum nao administra household;
- membros podem informar renda mensal manual para calculo de divisao;
- despesas compartilhadas mostram quem desembolsou;
- despesas compartilhadas usam divisao proporcional a renda por padrao;
- usuario pode marcar despesa compartilhada como 50/50;
- receitas e despesas individuais nao entram no acerto compartilhado;
- tela mostra quanto cada membro pagou, quanto deveria pagar e saldo liquido;
- tela mostra o acerto final necessario entre membros;
- RLS deve refletir essa restricao;
- funcoes de reparo/acesso nao podem conceder privilegio indevido.

### 7.11 Relatorios

Como usuario, quero visualizar resumo mensal dos gastos.

Criterios:

- total por perfil financeiro;
- total por pagador;
- total por categoria e subcategoria;
- filtro por mes;
- filtro por categoria;
- filtro por perfil;
- filtro por status de revisao.

### 7.12 Parcelas Futuras

Como usuario, quero antecipar as parcelas de compras no cartao que ainda vao cair.

Contexto: faturas de cartao sao importadas uma por mes e cada compra parcelada aparece com um marcador `k/n` (ex.: `1/6` = primeira de seis). A parcela `2/6` so entra quando a fatura do mes seguinte e importada.

Criterios:

- a importacao extrai `k/n` da descricao e grava `installment_number`, `installment_total` e `installment_group_key`;
- `/app/installments` projeta (calcula, sem gravar) as parcelas ainda nao lancadas a partir da ultima parcela conhecida de cada compra;
- as parcelas projetadas sao agrupadas por mes futuro, com subtotal por mes e total do compromisso restante;
- quando a fatura real de um mes e importada, a parcela real vira a nova ancora e a projezao encolhe automaticamente (sem transacoes falsas);
- a tela respeita `transaction_access`: so projeta parcelas de transacoes legiveis pelo usuario;
- por enquanto a projecao e apenas visualizacao: nao entra em relatorios nem no acerto do grupo.

## 8. Rotas

Rotas esperadas:

- `/login`;
- `/app`;
- `/app/groups`;
- `/app/imports`;
- `/app/transactions`;
- `/app/transactions/new`;
- `/app/transactions/[id]`;
- `/app/installments`;
- `/app/categories`;
- `/app/review`;
- `/app/rules`;
- `/app/reports` (redireciona 308 para `/app`; os relatorios/visualizacoes vivem no dashboard);
- `/app/settings`.

## 9. Schema de Banco

### 9.1 profiles

- `id uuid primary key`;
- `user_id uuid references auth.users(id)`;
- `display_name text`;
- `created_at timestamptz`.

### 9.2 households

- `id uuid primary key`;
- `name text`;
- `created_at timestamptz`.

### 9.3 household_members

- `id uuid primary key`;
- `household_id uuid`;
- `user_id uuid`;
- `role text`;
- `monthly_income numeric`;
- `created_at timestamptz`.

`monthly_income` deve ser nao negativo e representa a renda mensal atual usada no calculo proporcional da tela de grupos.

### 9.4 financial_profiles

- `id uuid primary key`;
- `household_id uuid`;
- `user_id uuid null`;
- `name text`;
- `type text`;
- `created_at timestamptz`.

Tipos:

- `individual`;
- `shared`.

### 9.5 categories

- `id uuid primary key`;
- `household_id uuid`;
- `name text`;
- `parent_id uuid null references categories(id)`;
- `created_by_user_id uuid null`;
- `is_default boolean`;
- `created_at timestamptz`.

### 9.6 user_category_exclusions

Registra categorias/subcategorias sugeridas que o usuario ocultou do seu gabarito.

- `id uuid primary key`;
- `household_id uuid`;
- `user_id uuid`;
- `category_id uuid references categories(id)`;
- `created_at timestamptz`.

### 9.7 transactions

- `id uuid primary key`;
- `household_id uuid`;
- `date date`;
- `description text`;
- `clean_description text`;
- `merchant text null`;
- `amount numeric`;
- `currency text default 'BRL'`;
- `source_name text null`;
- `source_type text null`; -- `credit_card` ou `bank_account`, usado no filtro de origem
- `import_dedup_key text null`; -- chave canonica para deduplicar importacoes repetidas
- `installment_number smallint null`; -- parcela atual (o k em k/n)
- `installment_total smallint null`; -- total de parcelas (o n em k/n)
- `installment_group_key text null`; -- agrupa as parcelas da mesma compra entre meses
- `reference_month text`;
- `paid_by_user_id uuid null`;
- `owner_profile_id uuid null`;
- `split_method text`;
- `category_id uuid null`;
- `subcategory_id uuid null`;
- `classification_method text`;
- `classification_confidence numeric null`;
- `classification_suggestion jsonb null`;
- `review_status text`;
- `created_by_user_id uuid`;
- `created_at timestamptz`;
- `updated_at timestamptz`.

`reference_month` deve usar formato `YYYY-MM`.

`split_method` deve aceitar:

- `income_proportional`: padrao; divide despesas compartilhadas proporcionalmente a `household_members.monthly_income`;
- `equal`: divide despesas compartilhadas igualmente entre membros.

O campo so tem efeito para despesas compartilhadas (`owner_profile.type = shared` e `amount < 0`). Receitas e despesas individuais nao devem afetar o acerto do grupo.

### 9.8 transaction_access

- `id uuid primary key`;
- `transaction_id uuid references transactions(id) on delete cascade`;
- `user_id uuid`;
- `can_read boolean`;
- `can_edit boolean`;
- `created_at timestamptz`.

### 9.9 classification_rules

- `id uuid primary key`;
- `household_id uuid`;
- `pattern text`;
- `pattern_type text`;
- `category_id uuid null`;
- `subcategory_id uuid null`;
- `owner_profile_id uuid null`;
- `confidence numeric`;
- `reinforcement_count integer`; -- quantas confirmacoes manuais reforcaram a regra
- `created_by_user_id uuid`;
- `active boolean`;
- `created_at timestamptz`.

`reinforcement_count` cresce a cada confirmacao manual repetida do mesmo padrao e eleva a confianca ate a regra passar a classificar automaticamente.

Tipos de padrao:

- `merchant_contains`;
- `description_contains`;
- `exact_merchant`;
- `regex`.

Evitar duplicidade de regra pessoal com a mesma combinacao:

- `household_id`;
- `created_by_user_id`;
- `pattern_type`;
- `pattern`.

### 9.10 transaction_imports

- `id uuid primary key`;
- `household_id uuid`;
- `created_by_user_id uuid`;
- `source_filename text`;
- `status text`;
- `row_count integer`;
- `source_type text null`; -- `credit_card` ou `bank_account`
- `reference_month text`;
- `created_at timestamptz`.

### 9.11 classification_jobs

Opcional, mas util.

- `id uuid primary key`;
- `household_id uuid`;
- `created_by_user_id uuid`;
- `status text`;
- `model text null`;
- `input_count integer`;
- `success_count integer`;
- `failed_count integer`;
- `created_at timestamptz`;
- `finished_at timestamptz null`.

### 9.12 audit_events

Opcional, mas util.

- `id uuid primary key`;
- `household_id uuid`;
- `user_id uuid null`;
- `event_type text`;
- `entity_type text`;
- `entity_id uuid null`;
- `metadata jsonb`;
- `created_at timestamptz`.

Nao armazenar dados financeiros brutos em audit metadata.

## 10. Controle de Acesso e RLS

Requisitos minimos:

- usuarios anonimos nao leem dados financeiros;
- usuarios so acessam households onde sao membros;
- usuarios so leem transacoes com `transaction_access.can_read = true`;
- usuarios so editam/apagam transacoes com `transaction_access.can_edit = true`;
- membros comuns nao administram household;
- somente admins gerenciam membros;
- policies de `transaction_access` nao permitem que qualquer membro conceda/revogue acesso arbitrariamente;
- `user_id` alvo em `transaction_access` precisa pertencer ao household;
- IDs relacionados em transacoes devem ser validados contra o household;
- `category_id` precisa pertencer ao household;
- `subcategory_id` precisa pertencer ao household e ter `parent_id = category_id`;
- `owner_profile_id` precisa pertencer ao household;
- `paid_by_user_id`, quando informado, precisa ser membro do household;
- funcoes `security definer` devem ficar em schema privado quando aplicavel;
- views expostas devem respeitar RLS ou usar `security_invoker`.

Frontend filtering nunca e suficiente.

## 11. Requisitos da LLM

A LLM e apenas assistente de classificacao.

A LLM nao deve:

- decidir permissao;
- ler todas as transacoes;
- receber arquivos brutos;
- receber nomes completos quando puder receber aliases;
- receber CPF;
- receber numero de cartao;
- receber conta bancaria;
- receber endereco;
- receber saldo;
- receber segredos;
- executar SQL;
- criar usuarios;
- alterar RLS;
- criar regra permanente sem confirmacao/aprendizado autorizado pelo usuario.

A LLM pode receber:

- id da transacao;
- merchant limpo;
- descricao limpa;
- valor;
- data ou mes;
- categorias/subcategorias permitidas;
- perfis anonimizados ou nomes nao sensiveis de atribuicao;
- regras pessoais relevantes;
- exemplos do gabarito generico.

Retorno esperado:

```json
{
  "category": "Saude",
  "subcategory": "Farmacia",
  "owner_profile": "Grupo",
  "confidence": 0.84,
  "needs_review": false,
  "reason_code": "known_pharmacy_merchant"
}
```

## 12. UX

Diretrizes:

- a tela inicial autenticada deve ser o produto, nao uma landing page;
- telas operacionais devem ser densas, claras e feitas para uso recorrente;
- a aba Transacoes usa dropdowns compactos sempre visiveis com auto-save por linha (estilo planilha), priorizando o minimo de cliques na revisao mensal;
- em outras tabelas, preferir leitura rapida com edicao sob demanda;
- a aba Transacoes deve priorizar filtro por mes, resumo e classificacao legivel;
- acoes destrutivas precisam de confirmacao;
- textos devem caber em desktop e mobile;
- nomes fixos como "Casal" nao devem aparecer quando houver nome real do grupo.
- a tela de grupo deve deixar claro quem pagou cada despesa compartilhada;
- a tela de grupo deve permitir editar renda mensal sem sair do contexto;
- a regra de divisao deve ser visivel por despesa, mas sem poluir receitas onde ela nao se aplica;
- o acerto final deve ser apresentado como uma instrucao direta de pagamento entre membros.

## 13. Setup e Deploy

Setup local:

1. clonar repo;
2. instalar dependencias;
3. copiar `.env.example` para `.env`;
4. preencher variaveis do proprio Supabase e LLM;
5. executar migrations;
6. rodar app local.

Variaveis:

- `PUBLIC_SUPABASE_URL`;
- `PUBLIC_SUPABASE_ANON_KEY`;
- `SUPABASE_SECRET_KEY`;
- `SUPABASE_DB_URL`;
- `OPENAI_API_KEY` ou `OPENROUTER_API_KEY`;
- `LLM_MODEL`.

Deploy:

- Vercel deve usar adapter real;
- build local no Windows pode usar adapter de validacao se necessario;
- nenhuma chave privada deve ser exposta no cliente.

## 14. Test Plan

Checks tecnicos:

- `npm run check`;
- `npm run build`;
- `npx supabase db push --dry-run --linked`;
- `npx supabase db lint --linked --fail-on error`;
- `npx supabase db advisors --linked`.

Cenarios manuais:

- usuario loga e acessa apenas seu household;
- membro comum nao administra grupo;
- renda mensal pode ser salva por membro do grupo;
- renda negativa ou membro invalido e rejeitado;
- cadastro manual em lote ignora linhas vazias;
- despesa compartilhada aparece com pagador na tela de grupo;
- despesa compartilhada permite alternar entre proporcional por renda e 50/50;
- receitas nao exibem seletor de divisao;
- divisao proporcional usa renda mensal e cai para divisao igual quando todas as rendas sao zero;
- acerto final mostra quem deve pagar para quem;
- importacao grava `reference_month`;
- importacao pre-classifica transacoes;
- transacao com categoria/subcategoria salvas aparece como texto;
- transacao com apenas sugestao aparece como sugerida;
- clicar em classificacao abre editor inline so naquela linha;
- subcategoria depende da categoria;
- salvar ajuste cria/atualiza regra pessoal;
- filtro por mes seleciona mes mais recente por padrao;
- excluir selecionadas respeita `can_edit`;
- excluir mes respeita `can_edit`;
- categoria oculta nao quebra transacao historica;
- repo clonado sem `.env` real e sem CSV pessoal ainda faz build com gabarito generico.

## 15. Roadmap

Prioridade alta:

- manter RLS e validacoes de household consistentes;
- melhorar onboarding inicial de household/admin;
- ampliar cobertura de testes em fluxos de classificacao e exclusao.

Prioridade media:

- melhorar relatorios;
- exportacao CSV;
- tela de auditoria;
- configuracao de modelos LLM pela UI.

Fora do escopo ate nova decisao:

- bancos/Open Finance;
- mobile nativo;
- billing SaaS.
