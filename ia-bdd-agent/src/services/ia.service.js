const axios = require('axios');
require('../../load-env');

const { geminiConfigured, runGeminiVisionAnalysis } = require('./gemini-vision.service');
const {
  VISION_SYSTEM,
  buildVisionUserPrompt,
  parseVisionJson,
} = require('../utils/vision-analysis-prompt');

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

/** Provedor de texto (BDD/refino): openai | ollama */
function resolveTextProvider() {
  const explicit = (process.env.BDD_TEXT_PROVIDER || process.env.BDD_AI_PROVIDER || '')
    .trim()
    .toLowerCase();
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

/** Provedor de visão (evidências Dev): gemini | openai */
function resolveVisionProvider() {
  const explicit = (process.env.BDD_VISION_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'gemini') return geminiConfigured() ? 'gemini' : null;
  if (explicit === 'openai') {
    return (process.env.OPENAI_API_KEY || '').trim() ? 'openai' : null;
  }
  if ((process.env.OPENAI_API_KEY || '').trim() && explicit !== 'gemini') {
    return 'openai';
  }
  if (geminiConfigured()) return 'gemini';
  return null;
}

/** @deprecated use resolveTextProvider */
function resolveProvider() {
  return resolveTextProvider();
}

function isLlmEnabled() {
  return process.env.BDD_USE_LLM === '1' && !!resolveTextProvider();
}

function isVisionCapable() {
  return !!resolveVisionProvider();
}

function visionProviderLabel() {
  return resolveVisionProvider() || 'none';
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

function openAIConfig() {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY não definido');
  const base = (process.env.OPENAI_API_BASE || DEFAULT_OPENAI_BASE).replace(/\/$/, '');
  return { apiKey, base };
}

function resolveOpenAIModel(opts = {}) {
  if (opts.vision) {
    return (
      process.env.BDD_OPENAI_VISION_MODEL ||
      process.env.OPENAI_VISION_MODEL ||
      'gpt-4o'
    ).trim();
  }
  return (
    process.env.BDD_AI_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL
  ).trim();
}

async function runOpenAIWithMessages(messages, opts = {}) {
  const { apiKey, base } = openAIConfig();
  const model = resolveOpenAIModel(opts);

  const res = await axios.post(
    `${base}/chat/completions`,
    {
      model,
      messages,
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

async function runOpenAIVisionAnalysis(userText, imagePayloads) {
  const userContent = [{ type: 'text', text: userText }];
  for (const img of imagePayloads || []) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.contentType || 'image/jpeg'};base64,${img.base64}`,
        detail: process.env.BDD_OPENAI_VISION_DETAIL || 'high',
      },
    });
  }

  const raw = await runOpenAIWithMessages(
    [
      { role: 'system', content: VISION_SYSTEM },
      { role: 'user', content: userContent },
    ],
    { vision: true }
  );
  return parseVisionJson(raw);
}

/**
 * Análise multimodal de evidências (imagens/vídeos) — Gemini ou OpenAI conforme BDD_VISION_PROVIDER.
 * @param {object} ctx
 * @param {{ base64: string, contentType: string, name?: string }[]} mediaPayloads
 */
async function runVisionEvidenceAnalysis(ctx, mediaPayloads) {
  const provider = resolveVisionProvider();
  if (!provider) {
    throw new Error('Nenhum provedor de visão configurado (GEMINI_API_KEY ou OPENAI_API_KEY)');
  }

  const userText = buildVisionUserPrompt(ctx);
  const media = mediaPayloads || [];

  if (provider === 'gemini') {
    const raw = await runGeminiVisionAnalysis(VISION_SYSTEM, userText, media);
    return { ...parseVisionJson(raw), _provider: 'gemini' };
  }

  const images = media.filter((m) => (m.contentType || '').startsWith('image/'));
  const parsed = await runOpenAIVisionAnalysis(userText, images);
  return { ...parsed, _provider: 'openai' };
}

async function runOpenAI(prompt) {
  return runOpenAIWithMessages(
    [
      {
        role: 'system',
        content:
          'Você é QA Mobilemed. Escreve Gherkin (pt-BR) executável: cada cenário com linha "Cenário:", Dado/Quando/Então na ordem correta, Então completo e verificável. Nunca use "E cenário:". Nunca coloque "E" após "Então". Use só fatos do chamado; sem meta-texto.',
      },
      { role: 'user', content: prompt },
    ],
    {}
  );
}

function llmTimeoutMs() {
  const n = Number.parseInt(process.env.BDD_AI_TIMEOUT_MS || '120000', 10);
  return Number.isFinite(n) && n > 5000 ? n : 120000;
}

async function runIA(prompt) {
  const provider = resolveTextProvider();
  if (!provider) {
    throw new Error(
      'Nenhum provedor de texto: defina OPENAI_API_KEY (BDD_TEXT_PROVIDER=openai) ou OLLAMA_URL+MODEL'
    );
  }
  if (provider === 'openai') return runOpenAI(prompt);
  return runOllama(prompt);
}

module.exports = {
  runIA,
  runOpenAIWithMessages,
  runVisionEvidenceAnalysis,
  isLlmEnabled,
  isVisionCapable,
  resolveProvider,
  resolveTextProvider,
  resolveVisionProvider,
  visionProviderLabel,
};
