# Prompts do ia-bdd-agent

## BDD (geração de cenários QA)

| Arquivo | Modo (`BDD_PROMPT_MODE`) | Quando usar |
|---------|--------------------------|-------------|
| `bdd.txt` | `default` | Roteiro completo; padrão se auto desligado |
| `bdd-novo-teste.txt` | `novo_teste` | Card novo em Novo Teste (auto) |
| `bdd-regressao.txt` | `regressao` | Revalidação após correção |
| `bdd-defeito.txt` | `defeito` | Resultado obtido preenchido (auto) |
| `bdd-integracao.txt` | `integracao` | Worklist + Portal, protocolo, CPF |
| `bdd-desktop-portable.txt` | `desktop_portable` | Portable, Laudário, gravação |
| `bdd-dicom-viewer.txt` | `dicom_viewer` | DICOM Viewer Web |
| `bdd-melhoria.txt` | `melhoria` | Feature / sugestão de melhoria |
| `bdd-vocab.txt` | — | Vocabulário Mobilemed (injetado em `{{VOCAB}}`) |

### Variáveis `.env`

```env
# Escolha fixa: nome do arquivo em prompts/
# BDD_PROMPT_FILE=bdd-defeito.txt

# Modo do catálogo: default | novo_teste | regressao | defeito | integracao | desktop_portable | dicom_viewer | melhoria | auto
BDD_PROMPT_MODE=auto

# Detecção automática por conteúdo do chamado (padrão: ligado). Desligar: BDD_PROMPT_AUTO=0
# BDD_PROMPT_AUTO=1

# Incluir bdd-vocab.txt no prompt. Desligar: BDD_INCLUDE_VOCAB=0

# Fontes: só título + Cenários Dev (padrão ligado). Dado: "acessa o ambiente …"
# BDD_ONLY_TITLE_AND_DEV=1

# Cenários extras além do Dev (smoke, negativo, integração). Máximo:
# BDD_COVERAGE_EXTRA=1
# BDD_COVERAGE_MAX_EXTRA=3
```

## Outros

| Arquivo | Uso |
|---------|-----|
| `reviewer.txt` | Revisão de qualidade dos cenários (`{{INPUT}}`) |
| `cypress.txt` | Geração Cypress (`{{CENARIOS}}`) |
| `parser.txt` | Extração estruturada de campos CRM |
| `coverage.txt` | Análise de cobertura / lacunas |

Placeholders comuns: `{{INPUT}}`, `{{VOCAB}}`, `{{CENARIOS}}`.
