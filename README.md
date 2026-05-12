Desenvolvido por Victor Martins

# ia-bdd-agent

Agente em Node.js que **lista itens no Bitrix24** (CRM), **lê o detalhe de cada chamado** e **gera cenários BDD em Gherkin** (português) a partir dos campos customizados (NGF). Modo padrão: geração **estruturada** a partir do CRM; opcionalmente usa **Ollama** para texto mais elaborado.
## Pré-requisitos
- [Node.js](https://nodejs.org/) 18+
- Webhook do Bitrix24 com permissão para `crm.item.list` e `crm.item.get`
- (Opcional) [Ollama](https://ollama.com/) rodando localmente ou em URL acessível

## Instalação

```bash
cd ia-bdd-agent
npm install
```
Na **raiz** do repositório `qa-ai-agent` também existe o script `npm run bdd`, que executa este pacote.

## Configuração
Crie o arquivo `.env` **nesta pasta** (`ia-bdd-agent/.env`):
```env
# Obrigatório: URL base do webhook Bitrix (sem barra no final)

# Exemplo: https://seudominio.bitrix24.com.br/rest/1/xxxxx
BITRIX_WEBHOOK=https://SEU_DOMINIO.bitrix24.com.br/rest/USER/TOKEN

# Opcional: depuração (imprime JSON completo de cada item)

# DEBUG_BITRIX=1

# Opcional: geração BDD via Ollama (desligado por padrão)

```bash
npm run bdd
```
Ou ainda:
```bash
node index.js
```
## O que o fluxo faz
1. Carrega variáveis de `load-env.js` (`.env` sempre relativo a esta pasta).

2. Chama o Bitrix: lista itens → busca detalhe por ID.

3. Extrai texto dos campos NGF (descrição, passos, esperado/obtido, melhorias, etc.) em `src/agents/parser.js`.

4. Monta o BDD em `src/agents/bdd.agent.js` (Gherkin) e imprime no console.
## Estrutura (resumo)
| Caminho | Função |
|--------|--------|
| `index.js` | Entrada: loop de tarefas Bitrix → BDD |
| `load-env.js` | Carrega `.env` com caminho fixo |
| `src/services/bitrix.service.js` | Cliente HTTP Bitrix24 |
| `src/agents/parser.js` | Extração de contexto a partir do item CRM |
| `src/agents/bdd.agent.js` | Geração BDD (estruturada ou LLM) |
| `src/services/ia.service.js` | Chamada ao Ollama |
| `prompts/bdd.txt` | Template de prompt quando `BDD_USE_LLM=1` |

## Executar a partir da raiz

```bash
npm install
npm run bdd
```

## Exemplo de saída (modo estruturado)
```gherkin
Funcionalidade: Nome vindo do chamado
Cenário: Nome vindo do chamado — validação principal
  Dado que o sistema está em operação
  Quando …
  Então …
```
## Licença
ISC (conforme `package.json`).
