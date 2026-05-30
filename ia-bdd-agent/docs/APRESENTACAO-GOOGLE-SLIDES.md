# ia-bdd-agent — Slides para Google Slides / PowerPoint

Copie **cada bloco entre linhas `---`** como um slide novo no Google Slides ou PowerPoint.

**Dica Google Slides:** Arquivo → Importar slides → fazer upload deste `.md` (suporte limitado) **ou** colar título + bullets slide a slide.

**Dica PowerPoint:** Use extensão [Marp for VS Code](https://marketplace.visualstudio.com/items?itemName=marp-team.marp-vscode) no arquivo `APRESENTACAO-MARP.md` → Exportar PPTX.

---

## Slide 1 — Título

**ia-bdd-agent**

Do chamado Bitrix24 ao cenário BDD em Gherkin

- Victor Martins da Silva · QA Mobilemed
- Node.js · Bitrix24 REST · Gherkin (pt-BR)
- Automação contínua (`npm run poll`) ou sob demanda

---

## Slide 2 — O problema

**Hoje, sem o agente**

- Card em **Novo Teste** → QA escreve cenário manualmente
- Dados em **Descrição**, **Passos**, **Cenários Dev** (desorganizados)
- Formato **diferente** por squad
- Risco de **sobrescrever** cenário já aprovado no CRM

---

## Slide 3 — A solução

**O que o ia-bdd-agent faz**

1. Monitora fila **QA** no Bitrix24
2. Lê NGF + Cenários Dev + evidências
3. Gera **BDD Gherkin** (Dado / Quando / Então)
4. Valida estrutura (sem alucinação / sem truncar)
5. Grava em **Cenários QA** + arquivo `.feature`

---

## Slide 4 — Onde atua

| Item | Valor |
|------|--------|
| SPAs | 1276 (NGF) + 1294 (DICOM) |
| Colunas | Novo Teste, Teste de Q.A., Pronto para teste |
| Campo CRM | ufCrm100CenariosQa / ufCrm94CenariosQa |
| Não grava | Campo Dev, coluna desenvolvimento |

---

## Slide 5 — Fluxo

```
Bitrix (fila QA) → poll.js → lê card → gera BDD
    → reparo/rigor → grava CRM + output/*.feature
```

- Campo **vazio** → grava
- Campo **aprovado** → ignora
- Gherkin **inválido** → reescreve limpo

---

## Slide 6 — Arquitetura

**Entrada:** poll.js, bdd:item  
**Orquestração:** run-bitrix-bdd-cycle.js  
**Cérebro:** bdd.agent.js + parser.js  
**Bitrix:** bitrix.service.js, push-bdd-to-crm.js  
**Qualidade:** bdd-gherkin-structure.js, bdd-rigor.js, bdd-crm-merge.js  
**IA:** ia.service.js + prompts/

---

## Slide 7 — Pipeline de geração

1. **Estruturado** — Cenários Dev → QA (padrão)
2. **Refino OpenAI** — bdd-refine.txt (opcional)
3. **Pós-processo** — reparar, rigorizar, CRM sem comentários `#`

Fontes: Dev > passos > resultados > evidências > título

---

## Slide 8 — Arquivos importantes

| Arquivo | Função |
|---------|--------|
| bdd.agent.js | Geração + refino + validação |
| push-bdd-to-crm.js | Grava Cenários QA |
| bdd-gherkin.js | Monta Gherkin, parser título |
| bdd-gherkin-structure.js | Repara E cenário, Então vago |
| bdd-crm-merge.js | BDD limpo no CRM |
| poll.js | Fila automática |

---

## Slide 9 — Prompts por tipo

- **integracao** — Worklist, Portal, Leorad
- **desktop_portable** — Portable, laudário
- **defeito** — resultado obtido
- **refine** — corrige rascunho OpenAI
- **evidencias** — prints Dev
- Auto: `BDD_PROMPT_AUTO=1`

---

## Slide 10 — Demo ao vivo

```bash
npm run poll
npm run bdd:item -- 1258 1294
npm run bitrix:context
```

Mostrar: terminal BRT → card antes/depois → campo CRM → arquivo .feature

---

## Slide 11 — Benefícios

**QA:** rascunho pronto, revisão no Bitrix, não apaga aprovados  
**Time:** padrão Gherkin, menos retrabalho, rastreio em Git/output  
**Gestão:** automação 24/7 na fila, métricas no log do poll

---

## Slide 12 — Config e limitações

**.env:** BITRIX_WEBHOOK, ENTITY_TYPE_IDS, UF_BDD_FIELD, BDD_USE_LLM  
**Limites:** depende campos do chamado; API Bitrix; revisão humana obrigatória

**Frase final:** Automatiza a 1ª versão dos cenários QA quando o card entra na fila de teste.

**Repo:** github.com/victor-martinss/ia-bdd-agent

---

## Roteiro de fala (~2 min)

1. *"Todo card em Novo Teste exige cenário manual — demora e varia por squad."*
2. *"O agente lê Dev + NGF, gera Gherkin e preenche Cenários QA."*
3. *"Se o campo já tem cenário aprovado, não mexe."*
4. *"Roda com npm run poll; a equipe revisa no Bitrix."*
