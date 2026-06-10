require('../../load-env');
const axios = require('axios');
const { getEntityTypeId } = require('./bitrix.service');

const BASE_URL = process.env.BITRIX_WEBHOOK;

/** @type {Map<number, string[]>} */
const qaStageIdsCache = new Map();

/** @type {Map<number, string[]>} */
const devStageIdsCache = new Map();

/** @type {Map<number, string[]>} */
const novoTesteStageIdsCache = new Map();

/** @type {Map<string, string>} */
const stageNameByIdCache = new Map();

function restErrorMessage(data) {
  if (!data || typeof data !== 'object') return '';
  if (data.error) {
    return (
      (data.error_description && String(data.error_description)) ||
      String(data.error)
    );
  }
  return '';
}

function parseNameList(envVar, fallback) {
  const raw = (process.env[envVar] || fallback || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.length ? raw : [];
}

function novoTesteStageNameNeedles() {
  const fromEnv = parseNameList('BITRIX_NOVO_TESTE_STAGE_NAMES', 'Novo Teste');
  return fromEnv.length ? fromEnv : ['Novo Teste'];
}

function qaStageNameNeedles() {
  const fromQa = parseNameList('BITRIX_QA_STAGE_NAMES', '');
  const fromLegacy = parseNameList(
    'BITRIX_STAGE_NAMES',
    process.env.BITRIX_STAGE_NAME || ''
  );
  const merged = [...fromQa, ...fromLegacy];
  if (!merged.length) {
    return [
      'Novo Teste',
      'Teste de Q.A',
      'Testes de Q.A',
      'Testes de Q.A.',
      'Pronto para teste',
    ];
  }
  return [...new Set(merged)];
}

function devStageNameNeedles() {
  const fromEnv = parseNameList('BITRIX_DEV_STAGE_NAMES', '');
  if (fromEnv.length) return fromEnv;
  return [
    'Em Desenvolvimento',
    'Testes em Desenvolvimento',
    'Desenvolvimento',
    'Code Review',
    'Pronto para Desenvolvimento',
  ];
}

/** Esteiras/squads com funil ligado à validação QA (match parcial no nome da categoria). */
function qaCategoryNameNeedles() {
  const fromEnv = parseNameList('BITRIX_QA_CATEGORY_NAMES', '');
  if (fromEnv.length) return fromEnv;
  return [
    'dicom',
    'sustent',
    'improve',
    'core',
    'ngf',
    'mobile',
    'portable',
    'squad',
    'qualidade',
    'desenvolvimento q.a',
    'desenvolvimento qa',
  ];
}

function includeAllCategories() {
  if (process.env.BITRIX_QA_ALL_CATEGORIES === '0') return false;
  return !(process.env.BITRIX_QA_CATEGORY_NAMES || '').trim();
}

function categoryMatchesPipeline(categoryName, needles) {
  if (includeAllCategories()) return true;
  const name = String(categoryName || '').trim().toLowerCase();
  if (!name) return false;
  return needles.some((needle) => {
    const n = needle.toLowerCase();
    return name.includes(n) || n.includes(name);
  });
}

function stageNameMatchesNeedles(stageName, needles) {
  const name = String(stageName || '').trim().toLowerCase();
  if (!name) return false;
  return needles.some((needle) => {
    const n = needle.toLowerCase();
    return name.includes(n) || n === name;
  });
}

/** Colunas QA com nomes alternativos nas esteiras DICOM / Sustentação / Improve. */
function looksLikeQaStageName(stageName, devNeedles) {
  if (stageNameMatchesNeedles(stageName, devNeedles)) return false;
  if (process.env.BITRIX_QA_BROAD_STAGE_MATCH === '0') return false;
  const name = String(stageName || '').trim().toLowerCase();
  if (!name) return false;
  if (/teste(s)?\s*(de\s*)?q\.?\s*a\.?/i.test(name)) return true;
  if (/novo\s*teste/i.test(name)) return true;
  if (/pronto\s+para\s+teste/i.test(name)) return true;
  if (/em\s+teste(s)?\s*(de\s*)?qa/i.test(name)) return true;
  if (/valida[cç][aã]o\s*(de\s*)?(qa|qualidade)/i.test(name)) return true;
  if (/fila\s*(de\s*)?(qa|qualidade|teste)/i.test(name)) return true;
  if (/\bqa\b/.test(name) && !/dev|desenvolvimento/i.test(name)) return true;
  return false;
}

async function fetchCategories(entityTypeId) {
  if (!BASE_URL) return [];
  try {
    const response = await axios.get(`${BASE_URL}/crm.category.list`, {
      params: { entityTypeId },
      validateStatus: (s) => s >= 200 && s < 500,
    });
    if (restErrorMessage(response.data)) return [];
    const result = response.data.result;
    return (result && (result.categories || result.CATEGORIES)) || [];
  } catch {
    return [];
  }
}

async function fetchStatusesForCategory(entityTypeId, categoryId) {
  if (!BASE_URL) return [];
  const entityIdForStatus = `DYNAMIC_${entityTypeId}_STAGE_${categoryId}`;
  try {
    const response = await axios.post(
      `${BASE_URL}/crm.status.list`,
      { filter: { ENTITY_ID: entityIdForStatus } },
      {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (s) => s >= 200 && s < 500,
      }
    );
    if (restErrorMessage(response.data)) return [];
    const r = response.data.result;
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

/**
 * Resolve colunas QA por categoria (esteira) do SPA.
 * @returns {Promise<{ stageId: string, categoryId: number, categoryName: string, stageName: string }[]>}
 */
async function resolveQaStagesDetailed(entityTypeIdNum) {
  const needles = qaStageNameNeedles();
  const devNeedles = devStageNameNeedles();
  const categoryNeedles = qaCategoryNameNeedles();
  const rows = [];
  const categories = await fetchCategories(entityTypeIdNum);

  const catRows = categories.length
    ? categories.map((c) => ({
        id: Number(c.id ?? c.ID),
        name: String(c.name || c.NAME || '').trim(),
      }))
    : [{ id: 0, name: 'Padrão' }];

  for (const cat of catRows) {
    if (!Number.isFinite(cat.id)) continue;
    if (!categoryMatchesPipeline(cat.name, categoryNeedles)) continue;

    const statuses = await fetchStatusesForCategory(entityTypeIdNum, cat.id);
    for (const st of statuses) {
      const stageName = String(st.NAME || st.name || '').trim();
      const sid = st.STATUS_ID || st.statusId;
      if (!sid) continue;
      if (stageNameMatchesNeedles(stageName, devNeedles)) continue;
      const isQa =
        stageNameMatchesNeedles(stageName, needles) ||
        looksLikeQaStageName(stageName, devNeedles);
      if (!isQa) continue;
      rows.push({
        stageId: String(sid),
        categoryId: cat.id,
        categoryName: cat.name || `Categoria ${cat.id}`,
        stageName,
      });
    }
  }

  return rows;
}

/**
 * Resolve STAGE_IDs de colunas QA em categorias/esteiras integradas à validação QA.
 */
async function resolveNovoTesteStageIds(entityTypeIdNum) {
  if (novoTesteStageIdsCache.has(entityTypeIdNum)) {
    return novoTesteStageIdsCache.get(entityTypeIdNum);
  }
  const needles = novoTesteStageNameNeedles();
  const detailed = await resolveQaStagesDetailed(entityTypeIdNum);
  const ids = [
    ...new Set(
      detailed
        .filter((r) => stageNameMatchesNeedles(r.stageName, needles))
        .map((r) => r.stageId)
    ),
  ];
  novoTesteStageIdsCache.set(entityTypeIdNum, ids);
  for (const r of detailed) {
    stageNameByIdCache.set(`${entityTypeIdNum}:${r.stageId}`, r.stageName);
  }
  return ids;
}

async function resolveQaStageIds(entityTypeIdNum) {
  if (qaStageIdsCache.has(entityTypeIdNum)) {
    return qaStageIdsCache.get(entityTypeIdNum);
  }

  const detailed = await resolveQaStagesDetailed(entityTypeIdNum);
  const ids = [...new Set(detailed.map((r) => r.stageId))];
  qaStageIdsCache.set(entityTypeIdNum, ids);

  if (ids.length) {
    const byCat = new Map();
    for (const r of detailed) {
      if (!byCat.has(r.categoryName)) byCat.set(r.categoryName, 0);
      byCat.set(r.categoryName, byCat.get(r.categoryName) + 1);
    }
    const resumo = [...byCat.entries()]
      .map(([nome, n]) => `${nome} (${n} col.)`)
      .join(', ');
    console.log(
      `[Bitrix] SPA ${entityTypeIdNum} — esteiras QA: ${resumo || 'nenhuma'} → ${ids.length} estágio(s) no total`
    );
  }

  if (ids.length && process.env.DEBUG_BITRIX === '1') {
    for (const r of detailed) {
      console.log(
        `  · ${r.categoryName} / "${r.stageName}" → ${r.stageId}`
      );
    }
  }
  return ids;
}

async function resolveDevStageIds(entityTypeIdNum) {
  if (devStageIdsCache.has(entityTypeIdNum)) {
    return devStageIdsCache.get(entityTypeIdNum);
  }
  const needles = devStageNameNeedles();
  const matched = new Set();
  const categories = await fetchCategories(entityTypeIdNum);
  const catIds = categories.length
    ? categories.map((c) => Number(c.id ?? c.ID)).filter(Number.isFinite)
    : [0];

  for (const catId of catIds) {
    const statuses = await fetchStatusesForCategory(entityTypeIdNum, catId);
    for (const st of statuses) {
      const name = String(st.NAME || st.name || '').trim();
      const sid = st.STATUS_ID || st.statusId;
      if (!sid) continue;
      if (stageNameMatchesNeedles(name, needles)) matched.add(String(sid));
    }
  }
  const ids = [...matched];
  devStageIdsCache.set(entityTypeIdNum, ids);
  return ids;
}

function isStageInList(stageId, stageIds) {
  if (!stageId || !stageIds.length) return false;
  return stageIds.includes(String(stageId));
}

async function isQaStageId(stageId, entityTypeIdNum) {
  const qa = await resolveQaStageIds(entityTypeIdNum);
  return isStageInList(stageId, qa);
}

async function isDevStageId(stageId, entityTypeIdNum) {
  const dev = await resolveDevStageIds(entityTypeIdNum);
  return isStageInList(stageId, dev);
}

async function isNovoTesteStageId(stageId, entityTypeIdNum) {
  const novo = await resolveNovoTesteStageIds(entityTypeIdNum);
  return isStageInList(stageId, novo);
}

async function stageDisplayName(stageId, entityTypeIdNum) {
  const key = `${entityTypeIdNum}:${stageId}`;
  if (stageNameByIdCache.has(key)) return stageNameByIdCache.get(key);
  const detailed = await resolveQaStagesDetailed(entityTypeIdNum);
  for (const r of detailed) {
    stageNameByIdCache.set(`${entityTypeIdNum}:${r.stageId}`, r.stageName);
  }
  return stageNameByIdCache.get(key) || String(stageId || '');
}

function flattenCrmItem(item) {
  if (!item || typeof item !== 'object') return {};
  if (item.fields && typeof item.fields === 'object') {
    return { ...item, ...item.fields };
  }
  return item;
}

function buildStageFilter(qaStageIds) {
  if (!qaStageIds.length) return {};
  if (qaStageIds.length === 1) return { stageId: qaStageIds[0] };
  return { '@stageId': qaStageIds };
}

module.exports = {
  qaStageNameNeedles,
  novoTesteStageNameNeedles,
  qaCategoryNameNeedles,
  devStageNameNeedles,
  resolveQaStageIds,
  resolveNovoTesteStageIds,
  resolveQaStagesDetailed,
  resolveDevStageIds,
  isQaStageId,
  isNovoTesteStageId,
  isDevStageId,
  isStageInList,
  stageDisplayName,
  flattenCrmItem,
  buildStageFilter,
  fetchCategories,
  fetchStatusesForCategory,
  categoryMatchesPipeline,
  stageNameMatchesNeedles,
};
