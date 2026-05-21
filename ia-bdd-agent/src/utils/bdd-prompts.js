const path = require('path');
const fs = require('fs');

const PROMPTS_DIR = path.join(__dirname, '../../prompts');

/** @type {Map<string, string>} */
const templateCache = new Map();

const PROMPT_CATALOG = {
  default: {
    file: 'bdd.txt',
    label: 'Padrão (roteiro manual completo)',
  },
  novo_teste: {
    file: 'bdd-novo-teste.txt',
    label: 'Novo teste (primeira validação)',
  },
  regressao: {
    file: 'bdd-regressao.txt',
    label: 'Regressão após correção',
  },
  defeito: {
    file: 'bdd-defeito.txt',
    label: 'Reprodução de defeito',
  },
  integracao: {
    file: 'bdd-integracao.txt',
    label: 'Integração entre sistemas',
  },
  desktop_portable: {
    file: 'bdd-desktop-portable.txt',
    label: 'Portable / Laudário',
  },
  dicom_viewer: {
    file: 'bdd-dicom-viewer.txt',
    label: 'DICOM Viewer Web',
  },
  melhoria: {
    file: 'bdd-melhoria.txt',
    label: 'Melhoria / feature nova',
  },
  validacao_exata: {
    file: 'bdd-validacao-exata.txt',
    label: 'Validação exata (Então assertivos)',
  },
  evidencias: {
    file: 'bdd-evidencias.txt',
    label: 'BDD com análise de evidências Dev',
  },
  coverage_assertivo: {
    file: 'bdd-coverage-assertivo.txt',
    label: 'Cobertura ampla + validações exatas',
  },
};

function listPromptModes() {
  return Object.entries(PROMPT_CATALOG).map(([id, meta]) => ({
    id,
    file: meta.file,
    label: meta.label,
  }));
}

function readPromptFile(filename) {
  const key = filename;
  if (templateCache.has(key)) return templateCache.get(key);

  const full = path.isAbsolute(filename)
    ? filename
    : path.join(PROMPTS_DIR, filename);

  if (!fs.existsSync(full)) {
    throw new Error(`Prompt não encontrado: ${full}`);
  }

  const text = fs.readFileSync(full, 'utf8');
  templateCache.set(key, text);
  return text;
}

function readVocabBlock() {
  if (process.env.BDD_INCLUDE_VOCAB === '0') return '';
  try {
    return readPromptFile('bdd-vocab.txt');
  } catch {
    return '';
  }
}

function textoBusca(ctx, title) {
  return [
    title,
    ctx.titulo,
    ctx.descricao,
    ctx.passos,
    ctx.cenariosTesteDev,
    ctx.resultadoEsperado,
    ctx.resultadoObtido,
    ctx.evidenceResumo,
    ctx.sugestaoMelhoria,
    ctx.motivoMelhoria,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

/**
 * Escolhe o prompt mais adequado ao conteúdo do chamado.
 * @param {import('../agents/parser').extractTaskContext extends Function ? ReturnType<typeof extractTaskContext> : object} ctx
 * @param {string} title
 * @returns {string} id do catálogo (ex.: integracao)
 */
function detectPromptMode(ctx, title) {
  const t = textoBusca(ctx, title);

  if (limpar(ctx.evidenceResumo) && process.env.BDD_ASSERTIVE_MODE !== '0') {
    return 'evidencias';
  }

  if (
    process.env.BDD_ASSERTIVE_MODE !== '0' &&
    (limpar(ctx.resultadoEsperado) ||
      (ctx.evidenceValidacoes && ctx.evidenceValidacoes.length))
  ) {
    return 'validacao_exata';
  }

  if (ctx.resultadoObtido && limpar(ctx.resultadoObtido)) {
    return 'defeito';
  }

  if (process.env.BDD_COVERAGE_EXTRA !== '0' && process.env.BDD_ASSERTIVE_MODE !== '0') {
    if (/\b(cobertura|smoke|regress[aã]o)\b/i.test(t) || limpar(ctx.cenariosTesteDev)) {
      return 'coverage_assertivo';
    }
  }

  if (
    /\b(melhoria|feature|implementar|nova\s+funcionalidade|sugest[aã]o)\b/i.test(t) &&
    (limpar(ctx.sugestaoMelhoria) || limpar(ctx.motivoMelhoria))
  ) {
    return 'melhoria';
  }

  if (
    (/\bworklist\b/i.test(t) && /\bportal\b/i.test(t)) ||
    /\bsincroniz/i.test(t) ||
    (/\bprotocolo\b/i.test(t) && /\b(portal|worklist)\b/i.test(t)) ||
    /\bcpf\b/i.test(t) && /\b(portal|worklist|vincul)\b/i.test(t)
  ) {
    return 'integracao';
  }

  if (
    /\b(portable|laud[aá]rio|grava[çc][aã]o|desktop)\b/i.test(t) &&
    !/\bdicom\s+viewer\b/i.test(t)
  ) {
    return 'desktop_portable';
  }

  if (/\bdicom\b/i.test(t) && /\b(viewer|web|espelhamento|s[eé]rie)\b/i.test(t)) {
    return 'dicom_viewer';
  }

  if (/\b(regress[aã]o|revalidar|ap[oó]s\s+(corre[çc][aã]o|fix|deploy))\b/i.test(t)) {
    return 'regressao';
  }

  return 'novo_teste';
}

function limpar(s) {
  return String(s || '').trim();
}

/**
 * Resolve arquivo de prompt.
 * @param {{ ctx?: object, title?: string }} [hint]
 * @returns {{ file: string, mode: string, label: string, path: string }}
 */
function resolveBddPrompt(hint = {}) {
  const { ctx = {}, title = '' } = hint;

  const forcedFile = (process.env.BDD_PROMPT_FILE || '').trim();
  if (forcedFile) {
    const file = forcedFile.endsWith('.txt') ? forcedFile : `${forcedFile}.txt`;
    return {
      file,
      mode: 'custom',
      label: `Arquivo forçado (${file})`,
      path: path.join(PROMPTS_DIR, file),
    };
  }

  const forcedMode = (process.env.BDD_PROMPT_MODE || '').trim().toLowerCase();
  let mode = 'default';

  if (forcedMode && forcedMode !== 'auto') {
    if (PROMPT_CATALOG[forcedMode]) {
      mode = forcedMode;
    } else {
      const alias = forcedMode.replace(/-/g, '_');
      if (PROMPT_CATALOG[alias]) mode = alias;
    }
  } else if (forcedMode === 'auto' || process.env.BDD_PROMPT_AUTO === '1') {
    mode = detectPromptMode(ctx, title);
  } else if (process.env.BDD_PROMPT_AUTO !== '0') {
    mode = detectPromptMode(ctx, title);
  }

  const meta = PROMPT_CATALOG[mode] || PROMPT_CATALOG.default;
  return {
    file: meta.file,
    mode,
    label: meta.label,
    path: path.join(PROMPTS_DIR, meta.file),
  };
}

/**
 * Monta prompt final com vocabulário e input do chamado.
 * @param {string} input
 * @param {{ ctx?: object, title?: string }} [hint]
 */
function buildBddPrompt(input, hint = {}) {
  const resolved = resolveBddPrompt(hint);
  let tpl = readPromptFile(resolved.file);

  const vocab = readVocabBlock();
  if (tpl.includes('{{VOCAB}}')) {
    tpl = tpl.replace(
      '{{VOCAB}}',
      vocab ? `\n---\n${vocab}\n---\n` : ''
    );
  }

  const prompt = tpl.replace('{{INPUT}}', input);

  return { prompt, resolved };
}

function clearPromptCache() {
  templateCache.clear();
}

module.exports = {
  PROMPTS_DIR,
  PROMPT_CATALOG,
  listPromptModes,
  detectPromptMode,
  resolveBddPrompt,
  buildBddPrompt,
  readPromptFile,
  clearPromptCache,
};
