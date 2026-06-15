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

/** @type {Map<number, string[]>} */
const testeDeQaStageIdsCache = new Map();

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
  const fromEnv = parseNameList('BITRIX_NOVO_TESTE_STAGE_NAMES', 'Novo Teste,NEW');
  return fromEnv.length ? fromEnv : ['Novo Teste', 'NEW'];
}

function testeDeQaStageNameNeedles() {
  const fromEnv = parseNameList(
    'BITRIX_TESTE_QA_STAGE_NAMES',
    'Teste de Q.A,Testes de Q.A,Teste de QA,Testes de QA'
  );
  return fromEnv.length ? fromEnv : ['Teste de Q.A', 'Testes de Q.A', 'Teste de QA'];
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

/** Coluna "Novo Teste" (inclui estágios Bitrix com sufixo :NEW). */
function looksLikeNovoTesteStageId(stageId, stageName) {
  const sid = String(stageId || '').trim();
  if (/:NEW$/i.test(sid)) return true;
  if (/:NOVO_TESTE$/i.test(sid)) return true;
  const name = String(stageName || '').trim().toLowerCase();
  if (name === 'new' || name === 'novo') return true;
  return stageNameMatchesNeedles(stageName, novoTesteStageNameNeedles());
}

/** Coluna "Teste de Q.A." (exclui Novo Teste). */
function looksLikeTesteDeQaStageName(stageName) {
  const name = String(stageName || '').trim().toLowerCase();
  if (!name) return false;
  if (/novo\s*teste/i.test(name)) return false;
  if (/pronto\s+para\s+teste/i.test(name)) return false;
  if (/teste(s)?\s*(de\s*)?q\.?\s*a\.?/i.test(name)) return true;
  if (/em\s+teste(s)?\s*(de\s*)?qa/i.test(name)) return true;
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
/**
 * Todos os estágios do SPA (todas as categorias) — para card pai em outro funil.
 */
async function resolveAllStagesDetailed(entityTypeIdNum) {
  const maxAttempts = Number.parseInt(process.env.BITRIX_STAGE_FETCH_RETRIES || '3', 10) || 3;
  let lastRows = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const categories = await fetchCategories(entityTypeIdNum);
    const catIds = categories.length
      ? categories.map((c) => Number(c.id ?? c.ID)).filter(Number.isFinite)
      : [0];
    const rows = [];
    for (const catId of catIds) {
      const statuses = await fetchStatusesForCategory(entityTypeIdNum, catId);
      for (const st of statuses) {
        const stageName = String(st.NAME || st.name || '').trim();
        const sid = st.STATUS_ID || st.statusId;
        if (!sid) continue;
        const stageId = String(sid);
        rows.push({
          stageId,
          categoryId: catId,
          stageName,
        });
        stageNameByIdCache.set(`${entityTypeIdNum}:${stageId}`, stageName);
      }
    }
    lastRows = rows;
    if (rows.length > 0) return rows;
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  return lastRows;
}

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

async function resolveTesteDeQaStageIds(entityTypeIdNum) {
  if (testeDeQaStageIdsCache.has(entityTypeIdNum)) {
    return testeDeQaStageIdsCache.get(entityTypeIdNum);
  }
  const needles = testeDeQaStageNameNeedles();
  const novoNeedles = novoTesteStageNameNeedles();
  const detailed = await resolveAllStagesDetailed(entityTypeIdNum);
  const ids = [
    ...new Set(
      detailed
        .filter((r) => {
          if (stageNameMatchesNeedles(r.stageName, novoNeedles)) return false;
          return (
            stageNameMatchesNeedles(r.stageName, needles) ||
            looksLikeTesteDeQaStageName(r.stageName)
          );
        })
        .map((r) => r.stageId)
    ),
  ];
  if (ids.length > 0 || detailed.length > 0) {
    testeDeQaStageIdsCache.set(entityTypeIdNum, ids);
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
  if (isStageInList(stageId, novo)) return true;
  const name = await stageDisplayName(stageId, entityTypeIdNum);
  return looksLikeNovoTesteStageId(stageId, name);
}

async function isTesteDeQaStageId(stageId, entityTypeIdNum) {
  const extraIds = parseNameList('BITRIX_TESTE_QA_STAGE_IDS', '');
  if (isStageInList(stageId, extraIds)) return true;
  const cols = await resolveTesteDeQaStageIds(entityTypeIdNum);
  if (isStageInList(stageId, cols)) return true;
  const name = await stageDisplayName(stageId, entityTypeIdNum);
  return looksLikeTesteDeQaStageName(name);
}

async function stageDisplayName(stageId, entityTypeIdNum) {
  const key = `${entityTypeIdNum}:${stageId}`;
  if (stageNameByIdCache.has(key)) return stageNameByIdCache.get(key);
  await resolveAllStagesDetailed(entityTypeIdNum);
  if (stageNameByIdCache.has(key)) return stageNameByIdCache.get(key);
  await fetchStageNamesForCategoryFromStageId(stageId, entityTypeIdNum);
  return stageNameByIdCache.get(key) || String(stageId || '');
}

/** Extrai entityTypeId e categoryId de STAGE_ID Bitrix (ex.: DT1272_410:UC_YKVM7T). */
function parseStageIdParts(stageId) {
  const m = String(stageId || '').match(/^DT(\d+)_(\d+):/i);
  if (!m) return null;
  const entityTypeId = Number.parseInt(m[1], 10);
  const categoryId = Number.parseInt(m[2], 10);
  if (!Number.isFinite(entityTypeId) || !Number.isFinite(categoryId)) return null;
  return { entityTypeId, categoryId };
}

/** Busca nomes de estágio de uma categoria quando a listagem completa falhou (503). */
async function fetchStageNamesForCategoryFromStageId(stageId, entityTypeIdNum) {
  const parts = parseStageIdParts(stageId);
  if (!parts || parts.entityTypeId !== entityTypeIdNum) return;
  const statuses = await fetchStatusesForCategory(entityTypeIdNum, parts.categoryId);
  for (const st of statuses) {
    const sid = String(st.STATUS_ID || st.statusId || '');
    const stageName = String(st.NAME || st.name || '').trim();
    if (!sid) continue;
    stageNameByIdCache.set(`${entityTypeIdNum}:${sid}`, stageName);
  }
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
  testeDeQaStageNameNeedles,
  qaCategoryNameNeedles,
  devStageNameNeedles,
  resolveQaStageIds,
  resolveNovoTesteStageIds,
  resolveTesteDeQaStageIds,
  resolveAllStagesDetailed,
  resolveQaStagesDetailed,
  resolveDevStageIds,
  isQaStageId,
  isNovoTesteStageId,
  isTesteDeQaStageId,
  isDevStageId,
  isStageInList,
  stageDisplayName,
  looksLikeNovoTesteStageId,
  looksLikeTesteDeQaStageName,
  flattenCrmItem,
  buildStageFilter,
  fetchCategories,
  fetchStatusesForCategory,
  categoryMatchesPipeline,
  stageNameMatchesNeedles,
};
