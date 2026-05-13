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
- **Lista** itens (`crm.item.list`) e **busca o detalhe** de cada um (`crm.item.get`).
- O **tipo de entidade** (`entityTypeId`) é configurado em código (`ia-bdd-agent/src/services/bitrix.service.js`); o padrão do projeto é **1276** e deve corresponder ao objeto de CRM onde os chamados são armazenados.

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
- **`npm run test:api`**: sobe a API em porta temporária, dispara a massa e encerra.
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
```

**CRM:** o `entityTypeId` está em `ia-bdd-agent/src/services/bitrix.service.js` (padrão **1276**). Ajuste se o tipo de item for outro.

---

## Comandos na raiz do repositório

| Comando | O que faz |
|---------|-----------|
| `npm run bdd` | Uma execução: lista Bitrix → detalhe → BDD para **todas** as tarefas retornadas |
| `npm run poll` | A cada **15 min** (configurável): consulta a fila e gera BDD **só para IDs novos** (estado em `ia-bdd-agent/output/poll-state.json`) |
| `npm run api` | Sobe API HTTP (padrão `http://localhost:3050`) |
| `npm run test:api` | Sobe a API em porta temporária, dispara a massa de fixtures e encerra |

Na pasta **`ia-bdd-agent/`** os equivalentes são `npm start`, `npm run poll`, `npm run api`, `npm run test:api`.

**Entrada na raiz:** existe `index.js` na raiz que delega para `ia-bdd-agent/index.js`, então `node index.js` na raiz também dispara o fluxo Bitrix → BDD.

---

## Fila automática (poll)

- **Primeira execução:** todas as tarefas devolvidas pela lista do Bitrix são tratadas como novas → BDD + atualização do estado.
- **Próximas:** só processa IDs que **não** estão em `processedIds` no JSON de estado.
- **Reprocessar tudo:** apague `ia-bdd-agent/output/poll-state.json` (ou o arquivo definido em `BDD_POLL_STATE_FILE`).
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
| POST | `/bdd/from-fixture/:fixtureId` | Gera BDD a partir de um cenário da massa (sem corpo) |
| POST | `/bdd/from-item` | Body JSON: `{ "title"?: string, "item": { ... } }` — `item` obrigatório |

Resposta 200: `{ "bdd": "...", "title": "...", "fixtureId"?: "..." }`.

**Postman**

1. Importar `ia-bdd-agent/postman/ia-bdd-agent.postman_collection.json`
2. (Opcional) `ia-bdd-agent/postman/Local.postman_environment.json` — variável `baseUrl` (padrão `http://localhost:3050`)
3. Exemplo de body: `ia-bdd-agent/fixtures/postman-body-exemplo.json`

---

## Fluxo Bitrix → BDD

1. `load-env.js` carrega `ia-bdd-agent/.env`.
2. `bitrix.service.js` chama `crm.item.list` e `crm.item.get`.
3. `parser.js` monta contexto a partir dos campos NGF (e legados como `DETAIL_TEXT`).
4. `bdd.agent.js` gera Gherkin estruturado ou, com `BDD_USE_LLM=1`, chama Ollama usando `prompts/bdd.txt`.
5. `bdd-output.js` grava `.feature` e consolidado (se não estiver desligado).

---

## Estrutura (principal)

| Caminho | Função |
|---------|--------|
| `index.js` (raiz) | Delega para `ia-bdd-agent/index.js` |
| `ia-bdd-agent/index.js` | Uma execução: todas as tarefas da lista → BDD |
| `ia-bdd-agent/poll.js` | Loop com intervalo; só tarefas novas |
| `ia-bdd-agent/load-env.js` | Carrega `.env` pelo caminho do pacote |
| `ia-bdd-agent/api-server.js` | Sobe o servidor HTTP |
| `ia-bdd-agent/src/orchestrator/run-bitrix-bdd-cycle.js` | Ciclo compartilhado lista → detalhe → BDD → arquivos |
| `ia-bdd-agent/src/utils/poll-state.js` | Estado do poll (`processedIds`) |
| `ia-bdd-agent/src/utils/bdd-output.js` | Gravação em `output/` |
| `ia-bdd-agent/src/services/bitrix.service.js` | Cliente Bitrix24 |
| `ia-bdd-agent/src/agents/parser.js` | Extração de texto / NGF |
| `ia-bdd-agent/src/agents/bdd.agent.js` | Geração BDD |
| `ia-bdd-agent/fixtures/bdd-scenarios.json` | Massa para API / Postman |
| `ia-bdd-agent/scripts/run-api-fixtures.js` | Teste automatizado da API |

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
