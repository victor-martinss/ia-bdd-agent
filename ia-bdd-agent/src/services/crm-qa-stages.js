require('../../load-env');
const axios = require('axios');
const { getEntityTypeId } = require('./bitrix.service');

const BASE_URL = process.env.BITRIX_WEBHOOK;

/** @type {Map<number, string[]>} */
const qaStageIdsCache = new Map();

/** @type {Map<number, string[]>} */
const devStageIdsCache = new Map();

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

function stageNameMatchesNeedles(stageName, needles) {
  const name = String(stageName || '').trim().toLowerCase();
  if (!name) return false;
  return needles.some((needle) => {
    const n = needle.toLowerCase();
    return name.includes(n) || n === name;
  });
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
 * Resolve STAGE_IDs de colunas QA em **todas** as categorias do SPA.
 */
async function resolveQaStageIds(entityTypeIdNum) {
  if (qaStageIdsCache.has(entityTypeIdNum)) {
    return qaStageIdsCache.get(entityTypeIdNum);
  }

  const needles = qaStageNameNeedles();
  const devNeedles = devStageNameNeedles();
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
      if (stageNameMatchesNeedles(name, devNeedles)) continue;
      if (stageNameMatchesNeedles(name, needles)) {
        matched.add(String(sid));
      }
    }
  }

  const ids = [...matched];
  qaStageIdsCache.set(entityTypeIdNum, ids);
  if (ids.length && process.env.DEBUG_BITRIX === '1') {
    console.log(`[Bitrix] Colunas QA (${ids.length}): ${ids.join(', ')}`);
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
  devStageNameNeedles,
  resolveQaStageIds,
  resolveDevStageIds,
  isQaStageId,
  isDevStageId,
  isStageInList,
  flattenCrmItem,
  buildStageFilter,
  fetchCategories,
};
