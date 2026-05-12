Desenvolvido por Victor Martins da Silva

# qa-ai-agent

Repositório de automação e QA com o pacote **`ia-bdd-agent`**.

## ia-bdd-agent (resumo)

**Em uma linha:** agente que transforma chamados do Bitrix24 em cenários BDD (Gherkin), com opção de LLM (Ollama).

**Resumo:** agente em Node.js que **lê chamados/tarefas no Bitrix24** (via webhook do CRM), **extrai descrição, passos e resultados** dos campos customizados e **gera cenários BDD em Gherkin** (português): modo **estruturado** a partir do CRM ou, opcionalmente, texto mais rico via **Ollama** (`BDD_USE_LLM=1`).

**Texto curto (GitHub / ~350 caracteres):** integração Bitrix24 → BDD: busca itens do CRM, monta contexto QA a partir dos campos NGF e gera cenários Gherkin; suporte a geração assistida por LLM (Ollama) quando habilitado.

Documentação completa (instalação, `.env`, comandos, estrutura de pastas): **[ia-bdd-agent/README.md](ia-bdd-agent/README.md)**.

## Executar a partir da raiz

```bash
npm install
npm run bdd
```

O script `bdd` executa `ia-bdd-agent/index.js`. Configure o `.env` dentro de **`ia-bdd-agent/.env`**.

## Licença

ISC (conforme `package.json`).
