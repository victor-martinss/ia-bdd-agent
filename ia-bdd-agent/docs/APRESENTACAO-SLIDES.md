# ia-bdd-agent — Apresentação

**Autor:** Victor Martins da Silva  
**Público:** QA, desenvolvimento, gestão de produto  
**Duração sugerida:** 10–12 minutos

---

## Slide 1 — Título

# ia-bdd-agent
### Do chamado Bitrix24 ao cenário BDD em Gherkin

- Automação para a **equipe de Qualidade**
- Node.js + webhook Bitrix24
- Geração contínua (`npm run poll`) ou sob demanda

---

## Slide 2 — O problema

### Hoje, sem o agente

- Card entra na fila **Novo Teste** → QA monta cenários **manualmente**
- Informação espalhada: **Descrição**, **Passos**, **Cenários Dev**
- Formato inconsistente entre squads (DICOM, Sustentação, Improve…)
- Risco de **perder tempo** ou **sobrescrever** cenários já aprovados

---

## Slide 3 — A solução

### O que o ia-bdd-agent faz

1. **Monitora** a fila QA no Bitrix24 (colunas *Novo Teste*, *Teste de Q.A.*, etc.)
2. **Lê** descrição, passos e **Cenários de Teste (Dev)**
3. **Gera** BDD em português (Gherkin: Dado / Quando / Então)
4. **Grava** no campo **Cenários QA** do card (`ufCrm94CenariosQa` / `ufCrm100CenariosQa`)
5. **Salva** arquivo `.feature` em `output/` para revisão

---

## Slide 4 — Onde atua

### Escopo no Bitrix (Mobilemed)

| Item | Configuração |
|------|----------------|
| SPAs | **1276** (NGF) + **1294** (ex.: DICOM) |
| Esteiras | Todas integradas à QA (DICOM, Sustentação, Improve, Desenvolvimento QA…) |
| Colunas | **Novo Teste**, Teste de Q.A., Pronto para teste |
| Destino | Campo **Cenários QA** — não grava em coluna Dev |

---

## Slide 5 — Fluxo

```
Bitrix (fila Novo Teste)
        ↓
   poll.js (~30s)
        ↓
   Lê campos do card
   (Dev + descrição + passos)
        ↓
   Gera BDD Gherkin
        ↓
   Campo vazio?  → grava no CRM + .feature
   Campo cheio?  → ignora (não apaga aprovados)
```

---

## Slide 6 — Regras importantes

### Proteção do que QA já aprovou

| Situação | Comportamento |
|----------|----------------|
| **Cenários QA vazio** | Gera e grava BDD |
| **Cenários QA preenchido** | **Não altera** (log: “já preenchido”) |
| **Com marcador** `<<<BDD_IA_APPEND>>>` | Mantém bloco aprovado; atualiza só sugestão `[IA]` abaixo |

> Cenários Dev são **modelo**; Cenários QA é o **destino final** da equipe.

---

## Slide 7 — Fontes do BDD

### Prioridade na geração

1. **Cenários de Teste (Dev)** — base principal (cada bloco vira cenário QA)
2. **Descrição do ocorrido** — contexto (Dado)
3. **Passos para reproduzir** — ações (Quando / E)
4. **Resultado esperado** — verificação (Então)

Modo **LLM** (Ollama) opcional; padrão = gerador **estruturado** (sem IA externa).

---

## Slide 8 — Demo (ao vivo)

### O que mostrar

1. Terminal: `npm run poll` — horário **BRT**, resumo da fila
2. Card **novo** em Novo Teste → alerta `🆕 NOVO NA FILA QA`
3. Campo Cenários QA **antes** (vazio) e **depois** (Gherkin)
4. Card **já preenchido** → mensagem **ignorado**, CRM intacto

**Comandos úteis:**
```bash
cd ia-bdd-agent
npm run poll
npm run bdd:item -- <id> [1294]
npm run bitrix:context
```

---

## Slide 9 — Benefícios

| Para QA | Para o time |
|---------|-------------|
| Rascunho BDD pronto na chegada do card | Menos retrabalho manual |
| Não sobrescreve cenários aprovados | Formato Gherkin padronizado |
| Revisão no próprio Bitrix | Rastreio: logs + `.feature` + CRM |

---

## Slide 10 — Operação e configuração

### Essencial no `.env`

```env
BITRIX_WEBHOOK=...
BITRIX_ENTITY_TYPE_IDS=1276,1294
BITRIX_QA_STAGE_NAMES=Novo Teste,Teste de Q.A,Testes de Q.A,Pronto para teste
BITRIX_UF_BDD_FIELD=ufCrm100CenariosQa,ufCrm94CenariosQa
BDD_LOG_TIMEZONE=America/Sao_Paulo
```

- **Poll:** `npm run poll` (padrão ~30s entre ciclos)
- **Reiniciar** o poll após alterar `.env`

---

## Slide 11 — Limitações (transparência)

- Só processa o que a **API Bitrix** devolve (filtros de fila/coluna)
- **503** ou limite de API → alguns cards podem falhar na leitura (retry no próximo ciclo)
- Qualidade do BDD depende dos **campos preenchidos** no chamado
- LLM opcional; não é obrigatório para operar

---

## Slide 12 — Encerramento

### ia-bdd-agent em uma frase

> **Automatiza a primeira versão dos cenários QA a partir do que já está no Bitrix — na hora em que o card entra na fila de teste.**

**Próximos passos possíveis**
- Webhook Bitrix ao mover card → Novo Teste
- Integração com runner Cucumber / CI
- Filtro só esteira *Desenvolvimento QA* (`BITRIX_QA_CATEGORY_NAMES`)

**Repositório:** github.com/victor-martinss/ia-bdd-agent

---

## Notas para o apresentador (fala ~2 min)

Use este roteiro se tiver pouco tempo:

1. *“Toda vez que um card cai em Novo Teste, alguém precisa escrever cenário — isso demora e varia de squad para squad.”*
2. *“O agente fica olhando essa fila, lê Dev + descrição + passos, e preenche Cenários QA em Gherkin.”*
3. *“Se o campo já tem cenário aprovado, ele não mexe — só preenche quando está vazio.”*
4. *“Roda em background com npm run poll; a equipe revisa e ajusta no Bitrix.”*
