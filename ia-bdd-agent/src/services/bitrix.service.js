require('../../load-env');
const axios = require('axios');
const {
  withBitrixRetry,
  isRetryableHttpStatus,
} = require('../utils/bitrix-http-retry');

const BASE_URL = process.env.BITRIX_WEBHOOK;

/** @type {Promise<number> | null} */
let resolvedEntityTypeIdPromise = null;

/** Override por comando (ex.: bdd:item 1110 1294) — não altera o .env global. */
let runtimeEntityTypeIdOverride = null;

function setRuntimeEntityTypeIdOverride(entityTypeId) {
  const n = Number.parseInt(String(entityTypeId), 10);
  runtimeEntityTypeIdOverride = Number.isFinite(n) && n > 0 ? n : null;
}

function clearRuntimeEntityTypeIdOverride() {
  runtimeEntityTypeIdOverride = null;
}

/** IDs extras quando BITRIX_ENTITY_TYPE_IDS está definido. */
function extraEntityTypeIdsFromEnv() {
  const raw = (process.env.BITRIX_ENTITY_TYPE_IDS || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Ordem de probe para crm.item.get: principal, depois env, depois par 1276↔1294
 * (comum em portais com NGF + segundo SPA) se BITRIX_ENTITY_TYPE_IDS estiver vazio.
 * Desligar: BITRIX_DISABLE_BUILTIN_ENTITY_PROBE=1
 */
function buildEntityTypeIdCandidates(primaryEt) {
  const tried = new Set();
  const out = [];
  const push = (et) => {
    const n = Number.parseInt(String(et), 10);
    if (!Number.isFinite(n) || n <= 0 || tried.has(n)) return;
    tried.add(n);
    out.push(n);
  };

  push(primaryEt);
  for (const et of extraEntityTypeIdsFromEnv()) push(et);

  if (
    process.env.BITRIX_DISABLE_BUILTIN_ENTITY_PROBE !== '1' &&
    !(process.env.BITRIX_ENTITY_TYPE_IDS || '').trim()
  ) {
    for (const et of [1276, 1294]) push(et);
  }

  return out;
}

function listPageSize() {
  const n = Number.parseInt(process.env.BITRIX_LIST_PAGE_SIZE || '100', 10);
  if (Number.isFinite(n) && n >= 1 && n <= 500) return n;
  return 100;
}

function restErrorMessage(data) {
  if (!data || typeof data !== 'object') return 'resposta inválida do Bitrix';
  if (data.error) {
    return (
      (data.error_description && String(data.error_description)) ||
      String(data.error)
    );
  }
  return '';
}

function parseJsonEnv(varName) {
  const raw = process.env[varName];
  if (!raw || !String(raw).trim()) return null;
  try {
    return JSON.parse(String(raw).trim());
  } catch (e) {
    console.warn(`[Bitrix] ${varName} JSON inválido:`, e.message);
    return null;
  }
}

/**
 * entityTypeId explícito no .env, senão resolve pelo título do SPA (crm.type.list), senão 1276.
 */
async function getEntityTypeId() {
  if (runtimeEntityTypeIdOverride != null) {
    return runtimeEntityTypeIdOverride;
  }
  if (!resolvedEntityTypeIdPromise) {
    resolvedEntityTypeIdPromise = computeEntityTypeId();
  }
  return resolvedEntityTypeIdPromise;
}

async function computeEntityTypeId() {
  try {
    const explicit = Number.parseInt(process.env.BITRIX_ENTITY_TYPE_ID || '', 10);
    if (Number.isFinite(explicit) && explicit > 0) {
      console.log(`[Bitrix] entityTypeId=${explicit} (BITRIX_ENTITY_TYPE_ID)`);
      return explicit;
    }

    const titleNeedle = (process.env.BITRIX_SMART_PROCESS_TITLE || '').trim();
    if (titleNeedle) {
      const found = await resolveEntityTypeIdFromSpaTitle(titleNeedle);
      if (found) {
        console.log(
          `[Bitrix] SPA contendo "${titleNeedle}" → entityTypeId=${found} (BITRIX_SMART_PROCESS_TITLE)`
        );
        return found;
      }
      console.warn(
        `[Bitrix] Nenhum SPA em crm.type.list combina com "${titleNeedle}". Usando entityTypeId=1276. Defina BITRIX_ENTITY_TYPE_ID ou ajuste o título.`
      );
    }

    return 1276;
  } catch (e) {
    console.warn('[Bitrix] Erro ao resolver entityTypeId:', e.message || e);
    return 1276;
  }
}

/**
 * @param {string} titleNeedle
 * @returns {Promise<number | null>}
 */
async function resolveEntityTypeIdFromSpaTitle(titleNeedle) {
  const types = await fetchSpaTypesList();
  const needle = titleNeedle.toLowerCase();
  for (const t of types) {
    const tit = String(t.title || t.TITLE || '').toLowerCase();
    const nam = String(t.name || t.NAME || '').toLowerCase();
    if (
      tit.includes(needle) ||
      nam.includes(needle) ||
      needle.includes(tit) ||
      needle.includes(nam)
    ) {
      const id = t.entityTypeId ?? t.ENTITY_TYPE_ID;
      if (id != null && Number.isFinite(Number(id))) return Number(id);
    }
  }
  return null;
}

/** @type {unknown[] | null} */
let spaTypesListCache = null;

async function fetchSpaTypesList() {
  if (spaTypesListCache) return spaTypesListCache;
  if (!BASE_URL) {
    spaTypesListCache = [];
    return [];
  }
  const url = `${BASE_URL}/crm.type.list`;
  try {
    const response = await axios.get(url, {
      validateStatus: (s) => s >= 200 && s < 500,
    });
    const msg = restErrorMessage(response.data);
    if (msg) {
      if (process.env.DEBUG_BITRIX === '1') {
        console.warn('[Bitrix] crm.type.list:', msg);
      }
      spaTypesListCache = [];
      return [];
    }
    const result = response.data.result;
    const types = Array.isArray(result)
      ? result
      : (result && (result.types || result.TYPES)) || [];
    spaTypesListCache = types;
    return types;
  } catch (e) {
    if (process.env.DEBUG_BITRIX === '1') {
      console.warn('[Bitrix] crm.type.list (rede):', e.message || e);
    }
    spaTypesListCache = [];
    return [];
  }
}

/**
 * Código curto do SPA (ex. T82) usado em UF_CRM_TASK das tarefas atreladas.
 * @param {number} entityTypeIdNum
 */
async function getSpaSymbolCodeShortForEntityTypeId(entityTypeIdNum) {
  const types = await fetchSpaTypesList();
  const row = types.find(
    (t) => Number(t.entityTypeId ?? t.ENTITY_TYPE_ID) === entityTypeIdNum
  );
  if (!row) return null;
  const sym =
    row.symbolCodeShort ||
    row.SYMBOL_CODE_SHORT ||
    row.symbolCode ||
    row.SYMBOL_CODE;
  return sym != null && String(sym).trim() ? String(sym).trim() : null;
}

/**
 * Categoria (funil) padrão do SPA para montar ENTITY_ID dos estágios.
 * @param {number} entityTypeIdNum
 */
async function resolveDefaultCategoryId(entityTypeIdNum) {
  const explicit = Number.parseInt(process.env.BITRIX_CATEGORY_ID || '', 10);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;

  const url = `${BASE_URL}/crm.category.list`;
  const response = await axios.get(url, {
    params: { entityTypeId: entityTypeIdNum },
  });
  const msg = restErrorMessage(response.data);
  if (msg) {
    console.warn('[Bitrix] crm.category.list:', msg);
    return 0;
  }
  const result = response.data.result;
  const categories = (result && (result.categories || result.CATEGORIES)) || [];
  if (!categories.length) return 0;
  const def = categories.find(
    (c) => c.isDefault === 'Y' || c.IS_DEFAULT === 'Y' || c.isDefault === true
  );
  const id = (def || categories[0]).id ?? (def || categories[0]).ID;
  return id != null ? Number(id) : 0;
}

/**
 * Lista status (colunas/estágios) do SPA.
 * @param {string} entityIdForStatus ex.: DYNAMIC_1276_STAGE_0
 */
async function fetchStatusesForSpa(entityIdForStatus) {
  const url = `${BASE_URL}/crm.status.list`;
  const response = await axios.post(
    url,
    { filter: { ENTITY_ID: entityIdForStatus } },
    { headers: { 'Content-Type': 'application/json' } }
  );
  let msg = restErrorMessage(response.data);
  if (msg) {
    const responseGet = await axios.get(url, {
      params: { filter: { ENTITY_ID: entityIdForStatus } },
    });
    msg = restErrorMessage(responseGet.data);
    if (msg) {
      console.warn('[Bitrix] crm.status.list:', msg);
      return [];
    }
    const r = responseGet.data.result;
    return Array.isArray(r) ? r : (r && (r.statuses || r.STATUSES)) || [];
  }
  const r = response.data.result;
  return Array.isArray(r) ? r : (r && (r.statuses || r.STATUSES)) || [];
}

/**
 * Monta objeto filter para crm.item.list (colunas QA: Teste de Q.A., Novo Teste, etc.).
 * Busca estágios em **todas** as categorias do SPA (squads), não só na categoria padrão.
 * @param {number} entityTypeIdNum
 */
async function buildItemListFilter(entityTypeIdNum) {
  const fromEnv = parseJsonEnv('BITRIX_LIST_FILTER_JSON');
  if (fromEnv && typeof fromEnv === 'object' && Object.keys(fromEnv).length) {
    console.log('[Bitrix] filter a partir de BITRIX_LIST_FILTER_JSON');
    return fromEnv;
  }

  const { resolveQaStageIds, qaStageNameNeedles, buildStageFilter } = require('./crm-qa-stages');
  const matched = await resolveQaStageIds(entityTypeIdNum);

  if (!matched.length) {
    console.warn(
      `[Bitrix] Nenhuma coluna QA encontrada para: ${qaStageNameNeedles().join(', ')}. Ajuste BITRIX_QA_STAGE_NAMES ou BITRIX_STAGE_NAME.`
    );
    return {};
  }

  console.log(
    `[Bitrix] Fila QA (${qaStageNameNeedles().join(', ')}) → ${matched.length} estágio(s)`
  );
  return { __qaStageIds: matched, ...buildStageFilter(matched) };
}

/**
 * Lista itens do SPA (paginado). Usa POST com JSON para suportar `filter` (estágio/coluna).
 */
async function fetchCrmItemsPage(etId, filter, start, limit) {
  const url = `${BASE_URL}/crm.item.list`;
  const body = { entityTypeId: etId, start, limit };
  if (filter && Object.keys(filter).length) body.filter = filter;

  let response;
  try {
    response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: (s) => s >= 200 && s < 500,
    });
  } catch {
    response = await axios.get(url, {
      params: { entityTypeId: etId, start, limit, ...flattenFilterForGet(filter) },
      validateStatus: (s) => s >= 200 && s < 500,
    });
  }

  const msg = restErrorMessage(response.data);
  if (response.status >= 400 || msg) {
    throw new Error(msg || `HTTP ${response.status}`);
  }
  return (response.data.result && response.data.result.items) || [];
}

/**
 * SPAs consultados na fila QA (poll / bdd): principal + BITRIX_ENTITY_TYPE_IDS + probe 1276/1294.
 */
async function listEntityTypeIdsForQueue() {
  const primary = await getEntityTypeId();
  return buildEntityTypeIdCandidates(primary);
}

/**
 * Lista itens na fila QA de um único SPA (entityTypeId).
 * @param {number} etId
 */
async function attachPipelineLabels(etId, items) {
  const { resolveQaStagesDetailed } = require('./crm-qa-stages');
  const detailed = await resolveQaStagesDetailed(etId);
  const stageToPipeline = new Map(
    detailed.map((r) => [r.stageId, r.categoryName])
  );
  return items.map((it) => ({
    ...it,
    _pipelineName:
      stageToPipeline.get(String(it._stageId || it.stageId || '')) || '',
  }));
}

async function fetchQaQueueItemsForEntityType(etId) {
  const filter = await buildItemListFilter(etId);
  const limit = listPageSize();

  const qaStageIds = filter && filter.__qaStageIds;
  const cleanFilter = filter ? { ...filter } : {};
  delete cleanFilter.__qaStageIds;

  const normalize = (it) => {
    const id = it.id ?? it.ID;
    const title = it.title || it.TITLE || '';
    const stageId = it.stageId || it.STAGE_ID || '';
    const categoryId = it.categoryId ?? it.CATEGORY_ID;
    return {
      ...it,
      id,
      title,
      _entityTypeId: etId,
      _queueKey: `${etId}:${id}`,
      _stageId: stageId,
      _categoryId: categoryId,
    };
  };

  if (Array.isArray(qaStageIds) && qaStageIds.length > 1) {
    const byKey = new Map();
    for (const stageId of qaStageIds) {
      let start = 0;
      for (;;) {
        try {
          const items = await fetchCrmItemsPage(etId, { stageId }, start, limit);
          for (const it of items) {
            const row = normalize(it);
            if (row.id != null) byKey.set(row._queueKey, row);
          }
          if (items.length < limit) break;
          start += limit;
          if (start > 200000) break;
        } catch (e) {
          if (process.env.DEBUG_BITRIX === '1') {
            console.warn(`[Bitrix] crm.item.list stageId=${stageId}:`, e.message || e);
          }
          break;
        }
      }
    }
    return attachPipelineLabels(etId, [...byKey.values()]);
  }

  const allItems = [];
  let start = 0;
  const useFilter =
    Object.keys(cleanFilter).length > 0 ? cleanFilter : null;

  for (;;) {
    let items;
    try {
      items = await fetchCrmItemsPage(etId, useFilter, start, limit);
    } catch (e) {
      throw new Error(`crm.item.list: ${e.message || e}`);
    }
    for (const it of items) {
      allItems.push(normalize(it));
    }
    if (items.length < limit) break;
    start += limit;
    if (start > 200000) break;
  }

  return attachPipelineLabels(etId, allItems);
}

async function getTasks() {
  if (!BASE_URL) {
    throw new Error('BITRIX_WEBHOOK não definido');
  }

  const entityIds = await listEntityTypeIdsForQueue();
  const byKey = new Map();

  for (const etId of entityIds) {
    const batch = await fetchQaQueueItemsForEntityType(etId);
    for (const row of batch) {
      byKey.set(row._queueKey, row);
    }
  }

  if (entityIds.length > 1) {
    console.log(
      `[Bitrix] Fila QA unificada: ${byKey.size} card(s) em ${entityIds.length} SPA(s) — IDs ${entityIds.join(', ')}`
    );
  }

  return [...byKey.values()];
}

/**
 * Converte filter em params GET estilo filter[STAGE_ID]=...
 * @param {Record<string, unknown>} filter
 */
function flattenFilterForGet(filter) {
  if (!filter || typeof filter !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(filter)) {
    if ((k === '@STAGE_ID' || k === '@stageId') && Array.isArray(v)) {
      v.forEach((id, i) => {
        out[`filter[@stageId][${i}]`] = id;
      });
    } else if (v != null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        out[`filter[${k}][${k2}]`] = v2;
      }
    } else if (v != null) {
      out[`filter[${k}]`] = v;
    }
  }
  return out;
}

/**
 * @param {number} entityTypeId
 * @param {number} itemId
 * @returns {Promise<{ item: Record<string, unknown>, entityTypeId: number } | null>}
 */
async function fetchCrmItemByEntityTypeOnce(entityTypeId, itemId) {
  const url = `${BASE_URL}/crm.item.get`;
  const body = { entityTypeId, id: itemId };

  let response = await axios
    .get(url, {
      params: body,
      validateStatus: (s) => s >= 200 && s < 500,
    })
    .catch(() => null);

  let msg = response ? restErrorMessage(response.data) : 'falha na requisição GET';
  if (!response || response.status >= 400 || msg) {
    response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      validateStatus: (s) => s >= 200 && s < 500,
    });
    msg = restErrorMessage(response.data);
  }

  logRestDebug(`crm.item.get et=${entityTypeId}`, response);

  if (response.status >= 400 || msg) {
    if (response.data && response.data.error === 'NOT_FOUND') return null;
    const httpErr = new Error(
      msg || `crm.item.get HTTP ${response.status} (entityTypeId=${entityTypeId}, id=${itemId})`
    );
    httpErr.response = response;
    throw httpErr;
  }

  const item = response.data && response.data.result && response.data.result.item;
  if (!item) return null;
  return { item, entityTypeId };
}

async function fetchCrmItemByEntityType(entityTypeId, itemId) {
  const label = `crm.item.get ${itemId} (et=${entityTypeId})`;
  return withBitrixRetry(label, () =>
    fetchCrmItemByEntityTypeOnce(entityTypeId, itemId)
  );
}

/**
 * @param {number|string} id
 * @param {{ entityTypeId?: number, noGlobalOverride?: boolean }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
async function getTaskDetail(id, options = {}) {
  if (!BASE_URL) {
    throw new Error('BITRIX_WEBHOOK não definido');
  }

  const itemId = Number.parseInt(String(id), 10);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new Error(`ID de item CRM inválido: ${id}`);
  }

  const primaryEt =
    options.entityTypeId != null && Number.isFinite(Number(options.entityTypeId))
      ? Number(options.entityTypeId)
      : await getEntityTypeId();

  const candidates = buildEntityTypeIdCandidates(primaryEt);

  for (const etId of candidates) {
    const found = await fetchCrmItemByEntityType(etId, itemId);
    if (found) {
      if (etId !== primaryEt) {
        console.log(
          `[Bitrix] item ${itemId} encontrado em entityTypeId=${etId} (não estava em ${primaryEt})`
        );
        if (!options.noGlobalOverride) {
          setRuntimeEntityTypeIdOverride(etId);
        }
      }
      return found.item;
    }
  }

  const extras = extraEntityTypeIdsFromEnv();
  const hintEt =
    extras.length > 0
      ? ` Ou: npm run bdd:item -- ${itemId} <entityTypeId>`
      : ` Ou: npm run bdd:item -- ${itemId} 1294`;

  throw new Error(
    `Item CRM ${itemId} não encontrado nos SPAs tentados (principal entityTypeId=${primaryEt}).\n` +
      `• Confira o número na URL (…/type/1294/details/${itemId}/).\n` +
      `• type/1294 = SPA; details/1112 = id do card.${hintEt}\n` +
      `• Ajuste BITRIX_ENTITY_TYPE_ID ou BITRIX_ENTITY_TYPE_IDS no .env.\n` +
      `• Probe automático 1276+1294: desligue com BITRIX_DISABLE_BUILTIN_ENTITY_PROBE=1`
  );
}

async function updateCrmItemFieldsJson(id, fields, entityTypeId) {
  const url = `${BASE_URL}/crm.item.update`;
  const etId =
    entityTypeId != null && Number.isFinite(Number(entityTypeId))
      ? Number(entityTypeId)
      : await getEntityTypeId();
  return axios.post(
    url,
    {
      entityTypeId: etId,
      id,
      fields,
    },
    { validateStatus: (s) => s >= 200 && s < 600 }
  );
}

async function updateCrmItemFieldsForm(id, fields, entityTypeId) {
  const url = `${BASE_URL}/crm.item.update`;
  const etId =
    entityTypeId != null && Number.isFinite(Number(entityTypeId))
      ? Number(entityTypeId)
      : await getEntityTypeId();
  const params = new URLSearchParams();
  params.set('entityTypeId', String(etId));
  params.set('id', String(id));
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    params.set(`fields[${k}]`, String(v));
  }
  return axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: (s) => s >= 200 && s < 600,
  });
}

function logRestDebug(label, response) {
  if (process.env.BITRIX_DEBUG_REST !== '1') return;
  const data = response && response.data;
  console.error(
    `[BITRIX_DEBUG_REST] ${label} status=${response && response.status}`,
    typeof data === 'object' ? JSON.stringify(data).slice(0, 4000) : data
  );
}

async function updateCrmItemFieldsOnce(id, fields, etId) {
  let response = await updateCrmItemFieldsJson(id, fields, etId);
  logRestDebug('crm.item.update JSON', response);

  let msg = restErrorMessage(response.data);
  if (msg) {
    response = await updateCrmItemFieldsForm(id, fields, etId);
    logRestDebug('crm.item.update form-urlencoded (retry)', response);
    msg = restErrorMessage(response.data);
  }

  if (response.status >= 400 && isRetryableHttpStatus(response.status)) {
    const httpErr = new Error(
      msg || `crm.item.update HTTP ${response.status}`
    );
    httpErr.response = response;
    throw httpErr;
  }

  if (msg) throw new Error(msg);
  const { result } = response.data;
  if (result === false) {
    throw new Error('crm.item.update retornou result=false');
  }
  return result;
}

async function updateCrmItemFields(id, fields, options = {}) {
  if (!BASE_URL) {
    throw new Error('BITRIX_WEBHOOK não definido');
  }

  const etId = options.entityTypeId;
  const label = `crm.item.update ${id} (et=${etId || '?'})`;
  return withBitrixRetry(label, () => updateCrmItemFieldsOnce(id, fields, etId));
}

/**
 * Compat: valor síncrono só se BITRIX_ENTITY_TYPE_ID estiver definido; caso contrário 1276.
 * Prefira `getEntityTypeId()` após o primeiro `getTasks()`.
 */
function entityTypeIdSync() {
  const n = Number.parseInt(process.env.BITRIX_ENTITY_TYPE_ID || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1276;
}

module.exports = {
  getEntityTypeId,
  setRuntimeEntityTypeIdOverride,
  clearRuntimeEntityTypeIdOverride,
  /** @deprecated use getEntityTypeId() — mantido para scripts que esperam número síncrono */
  entityTypeId: entityTypeIdSync,
  getTasks,
  listEntityTypeIdsForQueue,
  fetchQaQueueItemsForEntityType,
  getTaskDetail,
  updateCrmItemFields,
  fetchSpaTypesList,
  getSpaSymbolCodeShortForEntityTypeId,
};
