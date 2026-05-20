const axios = require('axios');
require('../../load-env');

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

function resolveProvider() {
  const explicit = (process.env.BDD_AI_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'openai') return 'openai';
  if (explicit === 'ollama') return 'ollama';
  if (process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()) {
    return 'openai';
  }
  if (process.env.OLLAMA_URL && String(process.env.OLLAMA_URL).trim()) {
    return 'ollama';
  }
  return null;
}

/** LLM habilitada no .env (BDD_USE_LLM=1 + provedor configurado). */
function isLlmEnabled() {
  return process.env.BDD_USE_LLM === '1' && !!resolveProvider();
}

async function runOllama(prompt) {
  const url = process.env.OLLAMA_URL;
  const model = process.env.MODEL || process.env.BDD_AI_MODEL;
  if (!url || !model) {
    throw new Error('OLLAMA_URL e MODEL (ou BDD_AI_MODEL) são obrigatórios para ollama');
  }
  const res = await axios.post(
    url,
    { model, prompt, stream: false },
    { timeout: llmTimeoutMs() }
  );
  const text = res.data && res.data.response;
  if (!text || typeof text !== 'string') {
    throw new Error('Ollama retornou resposta vazia');
  }
  return text;
}

async function runOpenAI(prompt) {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não definido');
  }
  const base = (process.env.OPENAI_API_BASE || DEFAULT_OPENAI_BASE).replace(/\/$/, '');
  const model =
    (process.env.BDD_AI_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim();

  const res = await axios.post(
    `${base}/chat/completions`,
    {
      model,
      messages: [
        {
          role: 'system',
          content:
            'Você gera apenas cenários BDD em Gherkin em português. Sem explicações fora do formato Funcionalidade/Cenário/Dado/Quando/Então/E.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: Number.parseFloat(process.env.BDD_AI_TEMPERATURE || '0.2') || 0.2,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: llmTimeoutMs(),
      validateStatus: (s) => s >= 200 && s < 500,
    }
  );

  const msg = res.data && res.data.error && res.data.error.message;
  if (res.status >= 400 || msg) {
    throw new Error(msg || `OpenAI HTTP ${res.status}`);
  }

  const text = res.data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') {
    throw new Error('OpenAI retornou resposta vazia');
  }
  return text;
}

function llmTimeoutMs() {
  const n = Number.parseInt(process.env.BDD_AI_TIMEOUT_MS || '120000', 10);
  return Number.isFinite(n) && n > 5000 ? n : 120000;
}

/**
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function runIA(prompt) {
  const provider = resolveProvider();
  if (!provider) {
    throw new Error(
      'Nenhum provedor de IA: defina OPENAI_API_KEY (openai) ou OLLAMA_URL+MODEL (ollama)'
    );
  }
  if (provider === 'openai') return runOpenAI(prompt);
  return runOllama(prompt);
}

module.exports = {
  runIA,
  isLlmEnabled,
  resolveProvider,
};
