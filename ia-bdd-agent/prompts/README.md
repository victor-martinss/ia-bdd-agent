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
| `bdd-validacao-exata.txt` | `validacao_exata` | Então assertivos a partir de resultados e validações (auto) |
| `bdd-evidencias.txt` | `evidencias` | BDD após análise de prints/vídeos do Dev (auto) |
| `bdd-coverage-assertivo.txt` | `coverage_assertivo` | Dev + cobertura extra com critérios verificáveis |
| `bdd-vocab.txt` | — | Vocabulário Mobilemed (injetado em `{{VOCAB}}`) |

### Variáveis `.env`

```env
# Escolha fixa: nome do arquivo em prompts/
# BDD_PROMPT_FILE=bdd-defeito.txt

# Modo do catálogo: default | novo_teste | regressao | defeito | integracao | desktop_portable | dicom_viewer | melhoria | validacao_exata | evidencias | coverage_assertivo | auto
BDD_PROMPT_MODE=auto

# Detecção automática por conteúdo do chamado (padrão: ligado). Desligar: BDD_PROMPT_AUTO=0
# BDD_PROMPT_AUTO=1

# Incluir bdd-vocab.txt no prompt. Desligar: BDD_INCLUDE_VOCAB=0

# Modo assertivo (padrão): descrição, passos, resultados + evidências antes do BDD
# BDD_ASSERTIVE_MODE=1
# BDD_ANALYZE_EVIDENCE=1
# Texto (refino BDD): BDD_TEXT_PROVIDER=openai + OPENAI_API_KEY
# Visão (prints/vídeos Dev): BDD_VISION_PROVIDER=gemini + GEMINI_API_KEY
# BDD_GEMINI_VISION_MODEL=gemini-2.0-flash
# BDD_EVIDENCE_MAX_IMAGES=4
# BDD_ASSERTIVE_LLM=1   # força LLM mesmo com Cenários Dev

# Legado: só título + Dev (requer BDD_ASSERTIVE_MODE=0)
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
| `coverage-validacao-exata.txt` | Lacunas de assertividade + Então sugeridos |
| `coverage-evidencias.txt` | Cobertura cruzando evidências visuais do Dev |

Placeholders comuns: `{{INPUT}}`, `{{VOCAB}}`, `{{CENARIOS}}`.
