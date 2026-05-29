/**
 * Mescla BDD novo no campo do CRM sem alterar o bloco “aprovado” acima do marcador.
 * Convenção: a equipe fixa cenários aprovados acima da linha BITRIX_BDD_APPEND_MARKER;
 * abaixo dela só entra (e só é substituído) o bloco gerado pela automação (# [IA] …).
 */

function normalizeNewlines(s) {
  return String(s == null ? '' : s).replace(/\r\n/g, '\n');
}

/** Cabeçalho que a automação insere antes do Gherkin novo (identificado para substituição em re-runs). */
const IA_SUGGESTED_HEADER =
  '# [IA] Cenários sugeridos (geração automática — substituído a cada execução)';

function defaultAppendMarker() {
  const m = (process.env.BITRIX_BDD_APPEND_MARKER || '').trim();
  return m || '<<<BDD_IA_APPEND>>>';
}

function mergeFeatureEnabled() {
  return process.env.BITRIX_BDD_MERGE_BELOW_MARKER === '1';
}

/** Substituição limpa no UF (sem marcador / bloco [IA]). Padrão ligado. */
function cleanCrmWriteEnabled() {
  return process.env.BITRIX_BDD_CLEAN_CRM_WRITE !== '0';
}

/**
 * Remove artefatos de automação do texto gravado no CRM (marcador, cabeçalho [IA], mapa).
 * @param {string} text
 */
function cleanGherkinForCrmField(text) {
  const marker = defaultAppendMarker();
  const lines = normalizeNewlines(text).split('\n');
  const out = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      out.push('');
      continue;
    }
    if (t === marker || /^<<<\s*BDD_IA_APPEND\s*>>>$/i.test(t)) continue;
    if (/^#\s*\[IA\]\s*Cenários sugeridos/i.test(t)) continue;
    if (/^#\s*Mapa cobertura:/i.test(t)) continue;
    if (/^#\s*Redundantes removidos:/i.test(t)) continue;
    out.push(line);
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function fieldHasIaAutomationArtifacts(text) {
  const t = normalizeNewlines(text);
  if (!t.trim()) return false;
  if (crmFieldHasMergeMarker(t, defaultAppendMarker())) return true;
  if (/BDD_IA_APPEND/i.test(t)) return true;
  if (/^\s*#\s*\[IA\]\s*Cenários sugeridos/im.test(t)) return true;
  return false;
}

/** BDD gerado pela IA fora do padrão Gherkin (ex.: linhas "E cenário:", Então incompleto). */
function fieldHasMalformedLlmGherkin(text) {
  const t = normalizeNewlines(text);
  if (!t.trim()) return false;
  if (/^\s*E\s+cen[aá]rio\s*:/im.test(t)) return true;
  if (!/^\s*Cen[aá]rio\s*:/im.test(t) && /cen[aá]rio\s*:/i.test(t)) return true;
  if (/^\s*ent[aã]o\s+a\s+mensagem\s*$/im.test(t)) return true;
  if (/^\s*ent[aã]o\s+o\s+(sistema|comportamento|resultado)\s*$/im.test(t)) return true;

  if (/funcionalidade\s*:/i.test(t) || /^\s*cen[aá]rio\s*:/im.test(t)) {
    try {
      const { validarEstruturaFeatureGherkin } = require('./bdd-gherkin-structure');
      const { ok } = validarEstruturaFeatureGherkin(t);
      if (!ok) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function fieldShouldRewriteToCleanBdd(text) {
  if (process.env.BITRIX_BDD_REWRITE_IA_BLOCKS === '0') return false;
  return fieldHasIaAutomationArtifacts(text) || fieldHasMalformedLlmGherkin(text);
}

/**
 * @param {string} text
 * @param {string} markerLine trim exato da linha
 */
function crmFieldHasMergeMarker(text, markerLine) {
  const t = normalizeNewlines(text);
  const m = markerLine.trim();
  if (!m) return false;
  return t.split('\n').some((line) => line.trim() === m);
}

/**
 * Remove o bloco antigo gerado pela IA (a partir do cabeçalho # [IA]…), mantendo notas manuais entre marcador e esse cabeçalho.
 * @param {string} segmentAfterMarker
 * @returns {{ keptBeforeIa: string }}
 */
function stripPreviousIaSuggestedBlock(segmentAfterMarker) {
  const lines = normalizeNewlines(segmentAfterMarker).split('\n');
  const hi = lines.findIndex((l) =>
    /^\s*#\s*\[IA\]\s*Cenários sugeridos/i.test(l)
  );
  if (hi === -1) {
    return { keptBeforeIa: segmentAfterMarker.trimEnd() };
  }
  return { keptBeforeIa: lines.slice(0, hi).join('\n').trimEnd() };
}

/**
 * @param {string} existingRaw texto atual do UF
 * @param {string} novaFeature Gherkin gerado (uma feature / bloco)
 * @param {string} markerLine
 * @returns {string | null} null se o marcador não existir
 */
function mergeBddBelowMarker(existingRaw, novaFeature, markerLine) {
  const marker = markerLine.trim();
  if (!marker) return null;

  const lines = normalizeNewlines(existingRaw).split('\n');
  const mi = lines.findIndex((line) => line.trim() === marker);
  if (mi === -1) return null;

  const head = lines.slice(0, mi + 1).join('\n').trimEnd();
  const afterMarker = lines.slice(mi + 1).join('\n');
  const { keptBeforeIa } = stripPreviousIaSuggestedBlock(afterMarker);

  const body = normalizeNewlines(novaFeature).trim();
  const parts = [head];
  if (keptBeforeIa) {
    parts.push('', keptBeforeIa);
  }
  parts.push('', IA_SUGGESTED_HEADER, '', body);
  return parts.join('\n').trimEnd();
}

/**
 * Preserva texto já no CRM e grava/atualiza só o bloco IA (com marcador).
 * @param {string} existingRaw
 * @param {string} novaFeature
 * @param {string} [markerLine]
 * @returns {string}
 */
function appendOrMergeBddInCrmField(existingRaw, novaFeature, markerLine) {
  const existing = normalizeNewlines(existingRaw).trim();
  const body = normalizeNewlines(novaFeature).trim();
  const marker = (markerLine || defaultAppendMarker()).trim();
  if (!existing) return body;
  if (!body) return existing;
  if (!marker) return `${existing}\n\n${IA_SUGGESTED_HEADER}\n\n${body}`.trimEnd();

  if (crmFieldHasMergeMarker(existing, marker)) {
    const merged = mergeBddBelowMarker(existing, body, marker);
    if (merged) return merged;
  }

  const parts = [existing, '', marker, '', IA_SUGGESTED_HEADER, '', body];
  return parts.join('\n').trimEnd();
}

module.exports = {
  defaultAppendMarker,
  mergeFeatureEnabled,
  cleanCrmWriteEnabled,
  cleanGherkinForCrmField,
  fieldHasIaAutomationArtifacts,
  fieldHasMalformedLlmGherkin,
  fieldShouldRewriteToCleanBdd,
  crmFieldHasMergeMarker,
  mergeBddBelowMarker,
  appendOrMergeBddInCrmField,
  IA_SUGGESTED_HEADER,
};
