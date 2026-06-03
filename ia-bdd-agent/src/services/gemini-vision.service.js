require('../../load-env');
const axios = require('axios');

const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_VISION_MODEL = 'gemini-2.0-flash';

function geminiApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GEMINI_API_KEY ||
    ''
  ).trim();
}

function resolveGeminiModel() {
  return (
    process.env.BDD_GEMINI_VISION_MODEL ||
    process.env.BDD_VISION_MODEL ||
    process.env.GEMINI_MODEL ||
    DEFAULT_GEMINI_VISION_MODEL
  ).trim();
}

function geminiBaseUrl() {
  return (process.env.GEMINI_API_BASE || DEFAULT_GEMINI_BASE).replace(/\/$/, '');
}

function geminiConfigured() {
  return !!geminiApiKey();
}

function visionTimeoutMs() {
  const n = Number.parseInt(
    process.env.BDD_VISION_TIMEOUT_MS || process.env.BDD_AI_TIMEOUT_MS || '180000',
    10
  );
  return Number.isFinite(n) && n > 5000 ? n : 180000;
}

/**
 * @param {string} systemInstruction
 * @param {string} userText
 * @param {{ base64: string, contentType: string, name?: string }[]} mediaParts imagens e/ou vídeos
 */
async function runGeminiVisionAnalysis(systemInstruction, userText, mediaParts) {
  const apiKey = geminiApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY não definido');
  }

  const model = resolveGeminiModel();
  const url = `${geminiBaseUrl()}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: userText }];
  for (const m of mediaParts || []) {
    if (!m?.base64) continue;
    const mime = m.contentType || 'image/jpeg';
    parts.push({
      inline_data: {
        mime_type: mime,
        data: m.base64,
      },
    });
  }

  const body = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature:
        Number.parseFloat(process.env.BDD_VISION_TEMPERATURE || '0.2') || 0.2,
      responseMimeType: 'application/json',
    },
  };

  const res = await axios.post(url, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: visionTimeoutMs(),
    validateStatus: (s) => s >= 200 && s < 500,
  });

  const err =
    res.data?.error?.message ||
    (res.status >= 400 ? `Gemini HTTP ${res.status}` : '');
  if (err) throw new Error(err);

  const partsOut = res.data?.candidates?.[0]?.content?.parts || [];
  const text = partsOut.map((p) => p.text || '').join('').trim();
  if (!text) {
    throw new Error('Gemini retornou resposta vazia');
  }
  return text;
}

module.exports = {
  geminiConfigured,
  resolveGeminiModel,
  runGeminiVisionAnalysis,
};
