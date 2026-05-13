Desenvolvido por Victor Martins da Silva

# qa-ai-agent

**Repositório no GitHub:** [github.com/victor-martinss/ia-bdd-agent](https://github.com/victor-martinss/ia-bdd-agent) · clonar com `git clone https://github.com/victor-martinss/ia-bdd-agent.git`

Repositório de automação e QA. O pacote **`ia-bdd-agent`** (pasta `ia-bdd-agent/`) lista chamados no **Bitrix24**, extrai campos NGF e gera cenários **BDD em Gherkin** (português). Há também **API HTTP** para testes via Postman, **massa em JSON**, **gravação de `.feature`** em disco e **poll** da fila a cada 15 minutos para tarefas novas.

---

## Descrição (GitHub / resumo)

**Em uma linha:** agente que transforma chamados do Bitrix24 em cenários BDD (Gherkin), com opção de LLM (Ollama).

**Resumo:** agente em Node.js que **lê chamados/tarefas no Bitrix24** (via webhook do CRM), **extrai descrição, passos e resultados** dos campos customizados e **gera cenários BDD em Gherkin** (português): modo **estruturado** a partir do CRM ou, opcionalmente, texto mais rico via **Ollama** (`BDD_USE_LLM=1`).

**Texto curto (~350 caracteres):** integração Bitrix24 → BDD: busca itens do CRM, monta contexto QA a partir dos campos NGF e gera cenários Gherkin; suporte a geração assistida por LLM (Ollama) quando habilitado; API local para fixtures; poll periódico para novas tarefas.

### Sobre o `ia-bdd-agent/load-env.js`

Carrega o **`.env`** da pasta `ia-bdd-agent` usando **`__dirname`**, para as variáveis existirem **mesmo** quando você roda `npm run bdd` ou `node index.js` **na raiz** do repositório.

---

## Funcionalidades — descrição completa

### Objetivo do sistema

O **ia-bdd-agent** automatiza parte do trabalho de QA ao **ler chamados no Bitrix24** (itens de CRM alinhados ao processo da equipe), **interpretar o texto operacional** (descrição, passos, resultados esperados e obtidos, melhorias, observações) e **converter isso em cenários BDD em Gherkin**, em **português**, prontos para revisão, documentação ou como base para automação de testes.

O foco é **reduzir retrabalho manual** e manter **formato previsível** entre chamado e especificação, com rastreio por arquivos `.feature` e logs.

---

### Integração com Bitrix24

- Usa o **webhook REST** (`BITRIX_WEBHOOK`), sem fluxo OAuth no uso típido.
- **Lista** itens (`crm.item.list`, com **paginação** e **filtro opcional** por estágio/coluna) e **busca o detalhe** (`crm.item.get`).
- O **tipo de entidade** (`entityTypeId`) vem de **`BITRIX_ENTITY_TYPE_ID`** ou é resolvido pelo título do SPA com **`BITRIX_SMART_PROCESS_TITLE`** (ex.: *Desenvolvimento Q.A.*) via `crm.type.list`. Padrão numérico **1276** se nada for encontrado.
- Para a coluna **Novo Teste**, use **`BITRIX_STAGE_NAME`** (ou `BITRIX_LIST_FILTER_JSON` com `STAGE_ID`). Comando auxiliar: **`npm run bitrix:context`** (lista SPA, categorias e `STAGE_ID` de cada coluna).
- Opcional: o mesmo BDD pode ser gravado em **tarefas Bitrix** atreladas ao card (`UF_CRM_TASK`); o webhook precisa incluir permissões de **CRM** e de **tarefas** (*task*). Ver variáveis **`BITRIX_TASK_UF_BDD_FIELD`** e **`BITRIX_PUSH_BDD_TO_LINKED_TASKS`** na seção de configuração.

---

### Extração e interpretação do chamado (parser)

- Lê campos **customizados NGF** (ex.: descrição do ocorrido, passos, resultado esperado/obtido, sugestão e motivo de melhoria, observações e triagem QA).
- Aceita campos **legados** quando existirem (`DETAIL_TEXT`, `detailText`, comentários, etc.).
- **Filtra placeholders** de formulário (ex.: `"x"`) para não gerar BDD vazio ou enganoso.
- Se os campos estiverem vazios, usa o **título do card** como fallback para ainda produzir um cenário mínimo útil.
- Consolida tudo em um **contexto textual** que alimenta o gerador de BDD.

---

### Geração de cenários BDD (Gherkin)

**Modo estruturado (padrão)**  
- Gera **Funcionalidade** e **Cenários** alinhados ao CRM: fluxo principal, cenário de **defeito** quando há divergência entre resultado esperado e obtido, e cenário de **melhoria** quando há sugestão/motivo.
- **Passos** viram sequência **Quando / E** (até `BDD_MAX_PASSO_LINES` frases, padrão 50).
- **Descrições longas** usam bloco **doc string (`"""`)** no Gherkin, sem truncar no meio.

**Modo com LLM (opcional)**  
- Com `BDD_USE_LLM=1` e Ollama (`OLLAMA_URL`, `MODEL`), o contexto do chamado é enviado ao modelo com o template `prompts/bdd.txt`, para redações mais variadas. O modo estruturado permanece quando o LLM não está habilitado.

---

### Artefatos em disco

- Grava em **`ia-bdd-agent/output/`** (configurável / desligável):
  - **Um `.feature` por tarefa** (`bdd-{id}-{titulo}.feature`).
  - **Consolidado por execução** (`bdd-todas-{timestamp}.feature`) com todos os cenários daquela rodada — ideal para revisão no editor sem limite de scroll do terminal.

---

### Execução sob demanda e fila automática (poll)

| Modo | Comando | Comportamento |
|------|---------|----------------|
| **Única rodada** | `npm run bdd` / `npm start` | Processa **todas** as tarefas retornadas pela lista do Bitrix naquele momento. |
| **Contínua** | `npm run poll` | A cada **15 minutos** (ou `BDD_POLL_INTERVAL_MINUTES`), consulta a fila, compara com `processedIds` em **`poll-state.json`** e gera BDD **apenas para IDs novos**. |
| **API** | `npm run api` | Gera BDD a partir de JSON (Postman, integrações, massa) sem chamar o Bitrix. |

Apagar **`poll-state.json`** zera o histórico de IDs vistos pelo poll (útil para testes ou mudança de processo).

---

### API HTTP, massa e regressão

- Endpoints: **health**, **listagem de fixtures**, **BDD por fixture** ou **BDD por item** (`POST /bdd/from-item`).
- Massa em **`fixtures/bdd-scenarios.json`**; exemplo de body em **`fixtures/postman-body-exemplo.json`**.
- **`npm run test:api`**: sobe a API em **porta livre** em `127.0.0.1` (ou a porta fixa `API_TEST_PORT` se definida), dispara a massa e encerra. Usa só módulos nativos do Node no cliente HTTP (não depende de `fetch` global).
- Coleção e environment de exemplo em **`ia-bdd-agent/postman/`**.

---

### Configuração e depuração

- Segredos no **`.env`** em `ia-bdd-agent/`, carregado por **`load-env.js`** com caminho fixo ao pacote.
- **`DEBUG_BITRIX=1`**: imprime o JSON detalhado do CRM no console para mapear campos.

---

### Limitações a considerar

- O agente só processa o que **`crm.item.list`** devolver (filtros/paginação do lado Bitrix).
- No poll, **“nova”** = **ID ainda não registrado** no estado; não há, no fluxo atual, disparo por “última alteração” do card.
- Geração via **LLM** depende do Ollama/modelo; o modo estruturado **não** depende disso.

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+
- Webhook Bitrix24 com permissão para `crm.item.list` e `crm.item.get`
- (Opcional) [Ollama](https://ollama.com/) se for usar `BDD_USE_LLM=1`

## Instalação

**Clone:** [https://github.com/victor-martinss/ia-bdd-agent.git](https://github.com/victor-martinss/ia-bdd-agent.git)

**Monorepo (raiz do Git com `package.json` e subpasta `ia-bdd-agent/` com o pacote Node):**

```bash
git clone https://github.com/victor-martinss/ia-bdd-agent.git
cd <pasta-criada-pelo-clone>
npm install
cd ia-bdd-agent
npm install
```

**Projeto só com o agente na raiz (sem subpasta `ia-bdd-agent/`):**

```bash
git clone https://github.com/victor-martinss/ia-bdd-agent.git
cd ia-bdd-agent
npm install
```

## Configuração (`.env`)

Crie **`ia-bdd-agent/.env`**:

```env
# Obrigatório — URL base do webhook Bitrix (sem barra no final)
BITRIX_WEBHOOK=https://SEU_DOMINIO.bitrix24.com.br/rest/USER/TOKEN

# Opcional — imprime JSON completo de cada item no console
# DEBUG_BITRIX=1

# Opcional — BDD via Ollama (é preciso BDD_USE_LLM=1)
# BDD_USE_LLM=1
# OLLAMA_URL=http://127.0.0.1:11434/api/generate
# MODEL=llama3.2

# Saída em arquivo (evita perder texto no scroll do terminal)
# Padrão: pasta ia-bdd-agent/output. Desligar: BDD_OUTPUT_DIR=0
# BDD_OUTPUT_DIR=output
# Máximo de frases Quando/E a partir dos passos (padrão 50)
# BDD_MAX_PASSO_LINES=50

# Fila automática (poll)
# BDD_POLL_INTERVAL_MINUTES=15
# BDD_POLL_STATE_FILE=output/poll-state.json

# API HTTP
# PORT=3050

# Após gerar o BDD, gravar no CRM (Teste Q.A. / Cenários QA). Desligar: BITRIX_PUSH_BDD_TO_UF=0
# BITRIX_ENTITY_TYPE_ID=1276
# SPA pelo nome (alternativa ao ID): BITRIX_SMART_PROCESS_TITLE=Desenvolvimento Q.A.
# Coluna Kanban / estágio "Novo Teste": BITRIX_STAGE_NAME=Novo Teste
# (opcional) BITRIX_CATEGORY_ID=0
# Filtro manual da lista: BITRIX_LIST_FILTER_JSON={"STAGE_ID":"DT..."}
# BITRIX_UF_BDD_FIELD=ufCrm94TesteQa
# (ou) BITRIX_UF_TESTE_QA=ufCrm94TesteQa
# BITRIX_UF_CENARIOS_QA=ufCrm94CenariosQa
# BITRIX_LIST_PAGE_SIZE=100
# BITRIX_DEBUG_REST=1
# BDD_CENARIOS_UF_MAX_CHARS=60000
# Tarefas Bitrix atreladas (UF_CRM_TASK): mesmo BDD no UF da tarefa
# BITRIX_TASK_UF_BDD_FIELD=ufTaskSeuCodigo
# Descoberta automática do UF na tarefa (tasks.task.get): desligar com BITRIX_TASK_UF_AUTO_DISCOVER=0
# BITRIX_TASK_GET_SELECT=ufTaskCampo1,ufTaskCampo2
# BITRIX_UF_CRM_TASK_VALUE={{symbol}}_{{id}}
# BITRIX_PUSH_BDD_TO_LINKED_TASKS=0
```

**CRM:** use **`BITRIX_ENTITY_TYPE_ID`** para o SPA correto, ou **`BITRIX_SMART_PROCESS_TITLE`** (ex.: `Desenvolvimento Q.A.`) para o código resolver o ID via `crm.type.list`. Para processar só cards na coluna **Novo Teste**, defina **`BITRIX_STAGE_NAME=Novo Teste`** (combinação parcial com o nome do estágio no Bitrix). Filtro avançado: **`BITRIX_LIST_FILTER_JSON`**. Liste tipos e colunas com **`npm run bitrix:context`**.

**Campo no CRM (BDD / “Teste Q.A.” / “Cenários QA”):** o texto Gherkin é gravado com **`crm.item.update`**. Defina o código REST do campo com **`BITRIX_UF_BDD_FIELD`** (ou **`BITRIX_UF_TESTE_QA`** / **`BITRIX_UF_CENARIOS_QA`**). Se não definir, o agente **procura no item** chaves `ufCrm*` que combinem com **“teste”+“qa”** ou **“cenário”+“qa”** (prioridade para *Teste Q.A.*). Fallback: `ufCrm94TesteQa`, depois `ufCrm94CenariosQa`. Vários códigos separados por vírgula são tentados em ordem. Lista **paginada** (`BITRIX_LIST_PAGE_SIZE`). Atualização **JSON** com retry **form-urlencoded**. **`BITRIX_DEBUG_REST=1`**: log REST. **`BITRIX_PUSH_BDD_TO_UF=0`**: não grava.

**Tarefas Bitrix atreladas ao card:** depois de gravar no item do SPA, o agente copia o **mesmo BDD** para **tarefas** ligadas via **`UF_CRM_TASK`** (`tasks.task.list` / `tasks.task.get` / `tasks.task.update`). O vínculo usa `SYMBOL_CODE_SHORT` do SPA (`crm.type.list`, ex. `T82_352`) e fallbacks (`CRM_DYNAMIC_{entityTypeId}_{id}`, …). Se o vínculo não bater, **`BITRIX_UF_CRM_TASK_VALUE`** com `{{id}}`, `{{entityTypeId}}`, `{{symbol}}`. **Campo de texto na tarefa:** defina **`BITRIX_TASK_UF_BDD_FIELD`** *ou* deixe vazio: o código **descobre** UFs na tarefa (nome com *teste*+*qa*, *cenário*+*qa*, *scenario*+*qa*), salvo **`BITRIX_TASK_UF_AUTO_DISCOVER=0`**. Se `tasks.task.get` não trouxer UFs, liste-os em **`BITRIX_TASK_GET_SELECT`** (separados por vírgula). Desligar gravação em tarefas: **`BITRIX_PUSH_BDD_TO_LINKED_TASKS=0`**.

**Checklist — cenários visíveis nas tarefas atreladas**

1. **Webhook** do Bitrix com permissões **CRM** e **tarefas** (*task*): `crm.item.*`, `tasks.task.list`, `tasks.task.get`, `tasks.task.update`.
2. **`BITRIX_PUSH_BDD_TO_LINKED_TASKS`** não pode ser `0` (omissão = tenta gravar nas tarefas quando existirem).
3. Ajuste **`BITRIX_ENTITY_TYPE_ID`** / **`BITRIX_SMART_PROCESS_TITLE`** para o SPA certo (o mesmo do card na fila de QA).
4. (Se precisar) **`BITRIX_UF_CRM_TASK_VALUE`** para bater exatamente com o valor de `UF_CRM_TASK` que o Bitrix grava na tarefa.
5. **`BITRIX_TASK_UF_BDD_FIELD`** com o código UF de texto **da tarefa**, *ou* confie na **descoberta automática**; se falhar, use **`BITRIX_TASK_GET_SELECT=ufSeuCampo`**.
6. Rode **`npm run bdd`**, **`npm run bdd:crm-sync`** ou **`npm run poll`**; no log deve aparecer **`Tarefas Bitrix atreladas: N …`**. Na **API**, com `itemId` no body, também grava nas tarefas (`linkedTasksPush`), salvo **`"pushToLinkedTasks": false`**.

**Itens já na fila (poll já “viu” o ID):** o `poll` só gera de novo para IDs **novos**. Para **reenviar o BDD ao CRM para todos os itens** que o Bitrix devolve na lista, use **`npm run bdd:crm-sync`** (atualiza também `poll-state.json` para não reprocessar tudo no próximo poll). Opção: `node ia-bdd-agent/scripts/sync-bdd-to-bitrix-once.js --no-poll-state` se não quiser alterar o estado.

---

## Comandos na raiz do repositório

| Comando | O que faz |
|---------|-----------|
| `npm run bdd` | Lista Bitrix → BDD → **item do SPA** + **tarefas atreladas** (se webhook/permissões) + `output/` |
| `npm run bdd:crm-sync` | Igual ao fluxo de BDD para **todos** os itens da lista e grava no CRM; atualiza `poll-state.json` (use `--no-poll-state` no script para não alterar o estado) |
| `npm run poll` | A cada **15 min**: só IDs novos → BDD + CRM + estado |
| `npm run api` | Sobe API HTTP (padrão `http://localhost:3050`) |
| `npm run bitrix:context` | Lista SPA (`crm.type.list`), categorias e **STAGE_ID** de cada coluna — use para montar o `.env` |
| `npm run test:api` | Sobe a API (porta livre ou `API_TEST_PORT`), dispara fixtures e encerra |

Na pasta **`ia-bdd-agent/`** os equivalentes são `npm start`, `npm run bdd:crm-sync`, `npm run poll`, `npm run api`, `npm run bitrix:context`, `npm run test:api`.

**Entrada na raiz:** existe `index.js` na raiz que delega para `ia-bdd-agent/index.js`, então `node index.js` na raiz também dispara o fluxo Bitrix → BDD.

---

## Fila automática (poll)

- **Primeira execução:** todas as tarefas devolvidas pela lista do Bitrix são tratadas como novas → BDD + atualização do estado.
- **Próximas:** só processa IDs que **não** estão em `processedIds` no JSON de estado.
- **Reprocessar tudo no CRM:** `npm run bdd:crm-sync` (recomendado) ou apague `ia-bdd-agent/output/poll-state.json` e rode o `poll` / `bdd` conforme o caso.
- **Produção:** mantenha o processo com PM2, agendador do Windows, systemd, etc.

---

## BDD em arquivo (visualizar cenários completos)

Por padrão, ao rodar `npm run bdd` / `npm start`:

- `ia-bdd-agent/output/bdd-{id}-{titulo}.feature` — um arquivo por chamado.
- `ia-bdd-agent/output/bdd-todas-{timestamp}.feature` — **todas** as tarefas da execução em um único arquivo.

Descrições longas no Gherkin usam bloco **`"""`** (texto completo). Para não gravar arquivos: `BDD_OUTPUT_DIR=0`.

---

## API HTTP (Postman)

```bash
npm run api
```

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET | `/health` | Status |
| GET | `/fixtures` | Lista IDs da massa (`fixtures/bdd-scenarios.json`) |
| POST | `/bdd/from-fixture/:fixtureId` | Gera BDD. Body opcional: `itemId`, `pushToCrm`, **`pushToLinkedTasks`** (padrão: grava também em **tarefas** atreladas ao `itemId`, como no `bdd`) |
| POST | `/bdd/from-item` | Body: `item`, `itemId`?, `pushToCrm`?, **`pushToLinkedTasks`**? — com `itemId`, atualiza CRM e, por padrão, **tarefas** vinculadas (`linkedTasksPush`) |

Resposta 200: `bdd`, `title`; se CRM: `crmItemId`, `crmPush`; se tarefas: **`linkedTasksPush`** (`updated`, `taskIds`, `failed`, `skipped`/`reason`). Desligar CRM: `"pushToCrm": false`. Desligar só tarefas: **`"pushToLinkedTasks": false`**.

**Postman**

1. Importar `ia-bdd-agent/postman/ia-bdd-agent.postman_collection.json`
2. (Opcional) `ia-bdd-agent/postman/Local.postman_environment.json` — variável `baseUrl` (padrão `http://localhost:3050`)
3. Exemplo de body: `ia-bdd-agent/fixtures/postman-body-exemplo.json`

---

## Fluxo Bitrix → BDD

1. `load-env.js` carrega `ia-bdd-agent/.env`.
2. `bitrix.service.js` chama `crm.item.list` (paginado, com filtro opcional por SPA/coluna) e `crm.item.get`.
3. `parser.js` monta contexto a partir dos campos NGF (e legados como `DETAIL_TEXT`).
4. `bdd.agent.js` gera Gherkin estruturado ou, com `BDD_USE_LLM=1`, chama Ollama usando `prompts/bdd.txt`.
5. `bdd-output.js` grava `.feature` e consolidado (se não estiver desligado).
6. `push-bdd-to-crm.js` grava no item do SPA; **`push-bdd-to-linked-tasks.js`** replica o BDD nas **tarefas** atreladas (`UF_CRM_TASK`), se `BITRIX_TASK_UF_BDD_FIELD` estiver definido e `BITRIX_PUSH_BDD_TO_LINKED_TASKS` não for `0`.

---

## Estrutura (principal)

| Caminho | Função |
|---------|--------|
| `index.js` (raiz) | Delega para `ia-bdd-agent/index.js` |
| `ia-bdd-agent/index.js` | Uma execução: itens da lista (filtro `.env`) → BDD → CRM |
| `ia-bdd-agent/poll.js` | Loop com intervalo; só tarefas novas |
| `ia-bdd-agent/load-env.js` | Carrega `.env` pelo caminho do pacote |
| `ia-bdd-agent/api-server.js` | Sobe o servidor HTTP |
| `ia-bdd-agent/src/orchestrator/run-bitrix-bdd-cycle.js` | Ciclo compartilhado lista → detalhe → BDD → arquivos |
| `ia-bdd-agent/src/services/push-bdd-to-linked-tasks.js` | BDD nas tarefas Bitrix vinculadas ao item (`UF_CRM_TASK`) |
| `ia-bdd-agent/src/utils/bdd-output.js` | Gravação em `output/` |
| `ia-bdd-agent/src/services/bitrix.service.js` | Cliente Bitrix24 |
| `ia-bdd-agent/src/agents/parser.js` | Extração de texto / NGF |
| `ia-bdd-agent/src/agents/bdd.agent.js` | Geração BDD |
| `ia-bdd-agent/fixtures/bdd-scenarios.json` | Massa para API / Postman |
| `ia-bdd-agent/scripts/bitrix-show-context.js` | `npm run bitrix:context` — SPA, categorias e estágios (STAGE_ID) |
| `ia-bdd-agent/scripts/sync-bdd-to-bitrix-once.js` | `npm run bdd:crm-sync` — fila completa → BDD → CRM + estado do poll |
| `ia-bdd-agent/scripts/run-api-fixtures.js` | `npm run test:api` — regressão da API HTTP |

---

## Exemplo de saída (modo estruturado)

```gherkin
Funcionalidade: Nome vindo do chamado

Cenário: Nome vindo do chamado — validação principal
  Dado que o sistema está em operação
  Quando …
  Então …
```

---

## Licença

ISC (conforme `package.json` da raiz e de `ia-bdd-agent`).