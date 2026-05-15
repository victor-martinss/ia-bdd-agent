Desenvolvido por Victor Martins da Silva

# qa-ai-agent

**Repositório no GitHub:** [github.com/victor-martinss/ia-bdd-agent](https://github.com/victor-martinss/ia-bdd-agent) · clonar com `git clone https://github.com/victor-martinss/ia-bdd-agent.git`

Repositório de automação e QA. O pacote **`ia-bdd-agent`** (pasta `ia-bdd-agent/`) lista chamados no **Bitrix24**, extrai campos NGF e gera cenários **BDD em Gherkin** (português). Há também **API HTTP** para testes via Postman, **massa em JSON**, **gravação de `.feature`** em disco e **poll** da fila QA (padrão **a cada ~30 segundos**, configurável), gerando cenários para cada **card novo** que entrar nas colunas de teste configuradas.

---

## Descrição (GitHub / resumo)

**Em uma linha:** agente que transforma chamados do Bitrix24 em cenários BDD (Gherkin), com opção de LLM (Ollama).

**Resumo:** agente em Node.js que **lê chamados/tarefas no Bitrix24** (via webhook do CRM), **extrai descrição, passos e resultados** dos campos customizados e **gera cenários BDD em Gherkin** (português): modo **estruturado** a partir do CRM ou, opcionalmente, texto mais rico via **Ollama** (`BDD_USE_LLM=1`).

**Texto curto (~350 caracteres):** integração Bitrix24 → BDD: busca itens do CRM, monta contexto QA a partir dos campos NGF e gera cenários Gherkin; suporte a geração assistida por LLM (Ollama) quando habilitado; API local para fixtures; **poll configurável da fila QA** (padrão ~30s entre consultas).

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
- **`bdd:item` / `crm.item.get`:** se **`BITRIX_ENTITY_TYPE_IDS`** não estiver definido no `.env`, o agente faz um **probe fixo nos SPAs 1276 e 1294** (ordem: principal primeiro, depois o outro). Assim **`npm run bdd:item -- 1112`** encontra o card em `type/1294/` sem passar o segundo argumento. Outros IDs: **`BITRIX_ENTITY_TYPE_IDS`** ou segundo argumento. Desligue o probe com **`BITRIX_DISABLE_BUILTIN_ENTITY_PROBE=1`**.
- **Fila QA:** o agente processa cards nas colunas de **teste/QA** em **todas as categorias (squads)** do SPA, não só na categoria padrão. Configure **`BITRIX_QA_STAGE_NAMES`** (recomendado) ou **`BITRIX_STAGE_NAME`** (legado). No Mobilemed os nomes costumam ser **Teste de Q.A.**, **Testes de Q.A.** e **Pronto para teste** (além de *Novo Teste*, se existir no seu funil).
- Comando auxiliar: **`npm run bitrix:context`** (lista SPA, categorias e `STAGE_ID` de cada coluna).
- Opcional: o mesmo BDD pode ser gravado em **tarefas Bitrix** atreladas ao card (`UF_CRM_TASK`); o webhook precisa incluir permissões de **CRM** e de **tarefas** (*task*). Ver **`BITRIX_TASK_UF_BDD_FIELD`** e **`BITRIX_PUSH_BDD_TO_LINKED_TASKS`**.
- **Somente QA no CRM:** cenários vão para o campo definido em **`BITRIX_UF_BDD_FIELD`** (ex.: **`ufCrm100CenariosQa`** no SPA `type/1294/…`, **`ufCrm94CenariosQa`** no NGF `1276`). O agente **não grava** em campos *Dev* nem em cards em colunas de **desenvolvimento**, salvo **`BITRIX_PUSH_BDD_ON_DEV_CARD=1`**.

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
- Gera **Funcionalidade** e **Cenários** em português com **Dado / Quando / Então / E**, de forma **objetiva** (sem colar parágrafos inteiros da descrição do chamado).
- Fluxo principal, cenário de **defeito** (resultado esperado × obtido) e cenário de **melhoria** quando houver sugestão/motivo.
- **Passos** do CRM viram **Quando / E** (até `BDD_MAX_PASSO_LINES`, padrão 12 no gerador objetivo).
- Se o card tiver só **título** (campos NGF vazios), monta cenário mínimo a partir do título.

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
| **Única rodada** | `npm run bdd` / `npm start` | Processa **todos os cards da fila QA** (colunas configuradas em `BITRIX_QA_STAGE_NAMES`) → BDD → CRM + tarefas atreladas + `output/`. |
| **Um card** | `npm run bdd:item -- <id> [entityTypeId]` | Gera BDD para um item CRM (`poll-state` ignorado). Com `.env` padrão tenta **1276 e 1294** automaticamente se **`BITRIX_ENTITY_TYPE_IDS`** estiver vazio. |
| **Contínua** | `npm run poll` | Consulta a fila QA em loop (padrão **30s** entre consultas; veja `BDD_POLL_INTERVAL_SECONDS`), compara com `processedIds` em **`poll-state.json`** e gera BDD **apenas para IDs novos**. |
| **API** | `npm run api` | Gera BDD a partir de JSON (Postman, integrações, massa) sem chamar o Bitrix. |
| **Diagnóstico** | `npm run bitrix:diagnose-linked -- <id>` | Lista vínculos CRM → tarefas Bitrix e UFs candidatos para um card. |

Apagar **`poll-state.json`** zera o histórico de IDs vistos pelo poll. Para **reprocessar IDs** sem apagar o arquivo: **`BDD_POLL_FORCE_IDS=360,222`** no `.env` (ou na sessão do terminal antes do `poll`).

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

- O **`crm.item.list`** da fila padrão já restringe aos **estágios QA** (`BITRIX_QA_STAGE_NAMES` / `resolveQaStageIds`) — ou seja, o robô olha primeiramente o que entrou na **fila da equipe de qualidade** (salvo `BITRIX_LIST_FILTER_JSON` customizado).
- No poll, **“nova”** = **ID ainda não registrado** no estado; não há, no fluxo atual, disparo por “última alteração” do card.
- Se o campo de cenários QA **já tem texto** sem “zona de atualização”, o item é **pulado** para **não sobrescrever** o que a equipe já aprovou/registrou. Opções: limpar o campo; **`BITRIX_SKIP_BDD_IF_QA_FILLED=0`** para substituir tudo; ou **`BITRIX_BDD_MERGE_BELOW_MARKER=1`** e uma linha **`BITRIX_BDD_APPEND_MARKER`** no final do bloco aprovado (a automação só atualiza o texto **abaixo** desse marcador, no bloco `# [IA] …`).
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

# Fila automática (poll): padrão 30s entre consultas (mín. 10s)
# BDD_POLL_INTERVAL_SECONDS=15
# (alternativa em minutos, aceita decimal ex. 0.5 = 30s): BDD_POLL_INTERVAL_MINUTES=1
# BDD_POLL_STATE_FILE=output/poll-state.json

# API HTTP
# PORT=3050
# Webhook de saída Bitrix → POST /webhooks/bitrix/outgoing (expor com ngrok / tunnel)
# BITRIX_OUTGOING_WEBHOOK_SECRET=troque_por_um_token_longo
# BITRIX_OUTGOING_ALLOW_QUERY_TOKEN=1
# BITRIX_OUTGOING_PROCESS_SYNC=0
# BDD_OUTGOING_MAX_BODY_BYTES=2097152

# Após gerar o BDD, gravar no CRM (Teste Q.A. / Cenários QA). Desligar: BITRIX_PUSH_BDD_TO_UF=0
# BITRIX_ENTITY_TYPE_ID=1276
# SPA pelo nome (alternativa ao ID): BITRIX_SMART_PROCESS_TITLE=Desenvolvimento Q.A.
# Fila QA (todas as categorias/squads do SPA):
BITRIX_QA_STAGE_NAMES=Novo Teste,Teste de Q.A,Testes de Q.A,Pronto para teste
# (legado) BITRIX_STAGE_NAME=Novo Teste
# Colunas de desenvolvimento (não recebem cenários no campo QA):
# BITRIX_DEV_STAGE_NAMES=Em Desenvolvimento,Testes em Desenvolvimento
# Símbolo do SPA se crm.type.list falhar (ACCESS_DENIED):
# BITRIX_SYMBOL_CODE_SHORT=T1276
# (opcional) BITRIX_CATEGORY_ID=0
# Filtro manual da lista: BITRIX_LIST_FILTER_JSON={"STAGE_ID":"DT..."}
# BITRIX_UF_BDD_FIELD=ufCrm100CenariosQa,ufCrm94CenariosQa
# (ou) BITRIX_UF_TESTE_QA / BITRIX_UF_CENARIOS_QA
# Se esses campos já tiverem texto no CRM, não gerar BDD de novo (principal + cards QA vinculados). Para desligar esta regra:
# BITRIX_SKIP_BDD_IF_QA_FILLED=0
# Preservar cenários já aprovados no topo do UF e só atualizar sugestões da IA abaixo de uma linha fixa (ex.: <<<BDD_IA_APPEND>>>):
# BITRIX_BDD_MERGE_BELOW_MARKER=1
# BITRIX_BDD_APPEND_MARKER=<<<BDD_IA_APPEND>>>
# BITRIX_LIST_PAGE_SIZE=100
# BITRIX_DEBUG_REST=1
# BDD_CENARIOS_UF_MAX_CHARS=60000
# Tarefas Bitrix atreladas (UF_CRM_TASK): mesmo BDD no UF da tarefa
# BITRIX_TASK_UF_BDD_FIELD=ufTaskSeuCodigo
# Descoberta automática do UF na tarefa (tasks.task.get): desligar com BITRIX_TASK_UF_AUTO_DISCOVER=0
# BITRIX_TASK_GET_SELECT=ufTaskCampo1,ufTaskCampo2
# BITRIX_UF_CRM_TASK_VALUE={{symbol}}_{{id}}
# BITRIX_PUSH_BDD_TO_LINKED_TASKS=0
# Reprocessar IDs no poll: BDD_POLL_FORCE_IDS=360,222
# Gravar BDD também em card de coluna Dev: BITRIX_PUSH_BDD_ON_DEV_CARD=1
```

**CRM:** use **`BITRIX_ENTITY_TYPE_ID`** para o SPA correto, ou **`BITRIX_SMART_PROCESS_TITLE`**. A **fila processada** (`bdd`, `poll`) usa **`BITRIX_QA_STAGE_NAMES`**: o código resolve os `STAGE_ID` em **todas as categorias** (Squad Sustentação, Core, DICOM, etc.). Filtro manual: **`BITRIX_LIST_FILTER_JSON`**. Liste colunas com **`npm run bitrix:context`**.

**Campo no CRM (BDD / “Teste Q.A.” / “Cenários QA”):** o texto Gherkin é gravado com **`crm.item.update`**. Defina o código REST com **`BITRIX_UF_BDD_FIELD`** (ou **`BITRIX_UF_TESTE_QA`** / **`BITRIX_UF_CENARIOS_QA`**). Exemplos: SPA **1294** → `ufCrm100CenariosQa`; SPA **1276** (NGF) → `ufCrm94CenariosQa`. Para operar nos dois, use lista: **`BITRIX_UF_BDD_FIELD=ufCrm100CenariosQa,ufCrm94CenariosQa`**. Se não definir, o agente **descobre** chaves `ufCrm*` no item; fallback interno tenta `ufCrm100*` e `ufCrm94*`. **Antes de gerar BDD**, o ciclo (`bdd`, `poll`, `bdd:item`, webhook) consulta esse(s) campo(s): se já houver texto útil **e** não houver zona de atualização configurada (**`BITRIX_BDD_MERGE_BELOW_MARKER=1`** com a linha **`BITRIX_BDD_APPEND_MARKER`** no próprio texto do campo), a **tarefa é ignorada** (evita sobrescrever cenários já aprovados). Com **`BITRIX_BDD_MERGE_BELOW_MARKER=1`** e essa linha no UF, preserva-se o bloco **acima** do marcador e só se substitui o trecho automático iniciado por **`# [IA] Cenários sugeridos…`**. Nos **cards QA vinculados** vale a mesma regra antes de gravar. Para **substituir o campo inteiro** mesmo preenchido: **`BITRIX_SKIP_BDD_IF_QA_FILLED=0`**. Lista **paginada** (`BITRIX_LIST_PAGE_SIZE`). **`BITRIX_DEBUG_REST=1`**: log REST. **`BITRIX_PUSH_BDD_TO_UF=0`**: não grava.

**Onde o BDD é gravado no CRM**

| Destino | Campo | Quando |
|---------|--------|--------|
| Card na **coluna QA** | `ufCrm100CenariosQa` ou `ufCrm94CenariosQa` (conforme `BITRIX_UF_BDD_FIELD`) | Card está em estágio QA (Teste de Q.A., etc.) |
| Card **Dev** | — | **Não grava** (evita cenários na tarefa de desenvolvimento) |
| Outro card QA **vinculado** (mesmo id externo/chamado) | mesmo campo QA configurado | `push-bdd-to-qa-linked-crm.js` |

**Tarefas Bitrix atreladas:** após gravar no card QA, o agente tenta copiar o BDD para **tarefas** com **`UF_CRM_TASK`** apontando para o item (`tasks.task.list` / `update`). Configure **`BITRIX_SYMBOL_CODE_SHORT`** se `crm.type.list` retornar `ACCESS_DENIED`. Vínculo: **`BITRIX_UF_CRM_TASK_VALUE={{symbol}}_{{id}}`**. Campo na tarefa: **`BITRIX_TASK_UF_BDD_FIELD`** ou descoberta automática. Desligar: **`BITRIX_PUSH_BDD_TO_LINKED_TASKS=0`**.

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
| `npm run bdd` | Lista **fila QA** → BDD → campo **`BITRIX_UF_BDD_FIELD`** + tarefas atreladas + `output/` |
| `npm run bdd:item -- <id> [entityTypeId]` | Um card CRM (ex.: `222` ou `1110 1294`) |
| `npm run bdd:crm-sync` | Todos os itens da fila QA → BDD → CRM; atualiza `poll-state.json` |
| `npm run poll` | Loop: consulta fila QA a cada **~30s** (configurável) → BDD só para IDs novos → CRM + `poll-state.json` |
| `npm run api` | API HTTP (padrão `http://localhost:3050`) |
| `npm run bitrix:context` | SPA, categorias e **STAGE_ID** de cada coluna |
| `npm run bitrix:diagnose-linked -- <id>` | Diagnóstico de vínculo CRM → tarefas Bitrix |
| `npm run test:api` | Regressão da API HTTP |

Na pasta **`ia-bdd-agent/`**: `npm run bdd` (= `npm start`), `bdd:item`, `bdd:crm-sync`, `poll`, `api`, `bitrix:context`, `bitrix:diagnose-linked`, `test:api`.

**Entrada na raiz:** existe `index.js` na raiz que delega para `ia-bdd-agent/index.js`, então `node index.js` na raiz também dispara o fluxo Bitrix → BDD.

---

## Fila automática (poll)

- **Comportamento:** o agente só usa a API REST do Bitrix (não há “push” nativo do CRM para o seu PC). Por isso o fluxo é **sondagem periódica** da fila QA. O intervalo padrão é **30 segundos** entre uma consulta e a próxima (após terminar BDD + gravações), com **mínimo de 10 segundos** para não sobrecarregar o Bitrix. Ajuste com **`BDD_POLL_INTERVAL_SECONDS=15`** (prioridade) ou **`BDD_POLL_INTERVAL_MINUTES`** (ex.: `1` para 1 minuto; decimais como `0.25` ≈ **15 segundos**).
- **Disparo instantâneo (opcional):** para reagir no mesmo segundo em que o card muda de coluna, exponha **`npm run api`** com URL pública e configure uma **automação/webhook de saída** Bitrix contra **`POST /webhooks/bitrix/outgoing`** (ver seção *API HTTP*). Alternativa menos imediata: reduzir `BDD_POLL_INTERVAL_SECONDS`.
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
| GET | `/webhooks/bitrix/outgoing` | Teste rápido — confirma que a rota existe (use **POST** para disparar BDD) |
| POST | `/webhooks/bitrix/outgoing` ou `/bitrix/outgoing` | Webhook **de saída** Bitrix / automação — gera BDD no item CRM (payload automático ou `{ "crmItemId", "entityTypeId"? }`) |

Para **`/bdd/from-item`** e **`/bdd/from-fixture`**, resposta 200 traz `bdd`, `title`; se CRM: `crmItemId`, `crmPush`; se tarefas: **`linkedTasksPush`**. Desligar CRM: `"pushToCrm": false`. Desligar tarefas vinculadas: **`"pushToLinkedTasks": false`**.

**Webhook de saída:** o POST em `/webhooks/bitrix/outgoing` responde logo com `{"ok":true,"accepted":true,"itemId":…}` e roda o mesmo fluxo do **`bdd:item`** em segundo plano (use **`BITRIX_OUTGOING_PROCESS_SYNC=1`** apenas se precisar esperar o fim na mesma requisição).

### Webhook de saída Bitrix (fila instantânea)

O Bitrix não invoca o seu PC sozinho — é preciso **URL pública** para a API (ngrok, Cloudflare Tunnel, VPS, etc.).

1. Rode **`npm run api`** (porta **`PORT`** ou **3050**). No `.env`:
   - **`BITRIX_OUTGOING_WEBHOOK_SECRET`** (recomendado): enviar **`Authorization: Bearer <segredo>`** ou cabeçalho **`X-Webhook-Secret`** / **`X-Bitrix-Webhook-Token`** com o mesmo valor.
   - **`BITRIX_OUTGOING_ALLOW_QUERY_TOKEN=1`** + `?token=<segredo>` na URL, se a automação Bitrix não permitir cabeçalhos (menos seguro).
2. Endpoint: **`https://SEU_HOST/webhooks/bitrix/outgoing`** (atalho: **`/bitrix/outgoing`**).
3. **Automação no funil SPA:** ao mover o card para coluna QA, ação **HTTP POST** com JSON usando os placeholders do Bitrix, por exemplo no espírito de `{ "crmItemId": "<ID>", "entityTypeId": "<ENTITY_TYPE_ID>" }` — adapte aos campos disponíveis no seu robô.
4. Alternativa mínima: **`POST ...?crmItemId=1112&entityTypeId=1294`**
5. Webhooks de saída do **Desenvolvedor** costumam mandar **form-urlencoded** (`data[FIELDS][ID]=…`); o servidor tenta interpretar isso também.

Se o corpo não trouxer ID, a API devolve **400** com trecho das chaves lidas — útil para alinhar uma vez o payload real do Bitrix.

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
6. `push-bdd-to-crm.js` grava no campo QA (`BITRIX_UF_BDD_FIELD`) só em cards **QA**; **`push-bdd-to-qa-linked-crm.js`** replica em outros cards QA vinculados; **`push-bdd-to-linked-tasks.js`** replica nas **tarefas Bitrix** (`UF_CRM_TASK`).

---

## Estrutura (principal)

| Caminho | Função |
|---------|--------|
| `index.js` (raiz) | Delega para `ia-bdd-agent/index.js` |
| `ia-bdd-agent/index.js` | Uma execução: itens da lista (filtro `.env`) → BDD → CRM |
| `ia-bdd-agent/poll.js` | Loop com intervalo; só tarefas novas |
| `ia-bdd-agent/load-env.js` | Carrega `.env` pelo caminho do pacote |
| `ia-bdd-agent/api-server.js` | Sobe o servidor HTTP |
| `ia-bdd-agent/src/services/bdd-from-item-runner.js` | BDD para um item CRM (uso: `bdd:item` e webhook) |
| `ia-bdd-agent/src/api/bitrix-outgoing-handler.js` | POST webhook Bitrix → fila BDD |
| `ia-bdd-agent/src/api/http-server.js` | Rotas HTTP (incl. `/webhooks/bitrix/outgoing`) |
| `ia-bdd-agent/src/orchestrator/run-bitrix-bdd-cycle.js` | Ciclo compartilhado lista → detalhe → BDD → arquivos |
| `ia-bdd-agent/src/services/crm-qa-stages.js` | Resolve colunas QA em todas as categorias do SPA |
| `ia-bdd-agent/src/services/push-bdd-to-qa-linked-crm.js` | BDD em cards CRM QA vinculados (não em colunas Dev) |
| `ia-bdd-agent/src/services/push-bdd-to-linked-tasks.js` | BDD nas tarefas Bitrix (`UF_CRM_TASK`) |
| `ia-bdd-agent/src/utils/bdd-gherkin.js` | Passos Gherkin objetivos (Dado/Quando/Então) |
| `ia-bdd-agent/scripts/run-bdd-item.js` | `npm run bdd:item` |
| `ia-bdd-agent/scripts/diagnose-linked-tasks.js` | `npm run bitrix:diagnose-linked` |
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
Funcionalidade: Portal Vet - teste

Cenário: Portal Vet - teste — validação principal
  Dado que o sistema está em operação
    E o usuário acessa o fluxo "Portal Vet"
  Quando executa o cenário "teste"
  Então o fluxo "teste" deve ser concluído com sucesso
```

Descrições longas do chamado viram passos curtos; o texto completo **não** é colado em blocos `"""`.

---

## Licença

ISC (conforme `package.json` da raiz e de `ia-bdd-agent`).