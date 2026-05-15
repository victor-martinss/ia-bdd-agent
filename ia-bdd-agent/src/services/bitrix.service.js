require('../../load-env');
const axios = require('axios');

const BASE_URL = process.env.BITRIX_WEBHOOK;

/** @type {Promise<number> | null} */
let resolvedEntityTypeIdPromise = null;

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
 * Monta objeto filter para crm.item.list (coluna "Novo Teste", etc.).
 * @param {number} entityTypeIdNum
 */
async function buildItemListFilter(entityTypeIdNum) {
  const fromEnv = parseJsonEnv('BITRIX_LIST_FILTER_JSON');
  if (fromEnv && typeof fromEnv === 'object' && Object.keys(fromEnv).length) {
    console.log('[Bitrix] filter a partir de BITRIX_LIST_FILTER_JSON');
    return fromEnv;
  }

  const stageNames = (
    process.env.BITRIX_STAGE_NAMES ||
    process.env.BITRIX_STAGE_NAME ||
    ''
  )
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!stageNames.length) return {};

  const categoryId = await resolveDefaultCategoryId(entityTypeIdNum);
  const entityIdForStatus = `DYNAMIC_${entityTypeIdNum}_STAGE_${categoryId}`;
  const statuses = await fetchStatusesForSpa(entityIdForStatus);
  const matched = [];
  for (const st of statuses) {
    const name = String(st.NAME || st.name || '').trim();
    const sid = st.STATUS_ID || st.statusId;
    if (!sid) continue;
    for (const needle of stageNames) {
      const nl = needle.toLowerCase();
      if (name.toLowerCase().includes(nl) || nl === name.toLowerCase()) {
        matched.push(String(sid));
        break;
      }
    }
  }

  if (!matched.length) {
    console.warn(
      `[Bitrix] Nenhum estágio encontrado para nome(s): ${stageNames.join(', ')} (ENTITY_ID=${entityIdForStatus}). Liste estágios com: npm run bitrix:context`
    );
    return {};
  }

  console.log(
    `[Bitrix] Filtro de estágio/coluna → STAGE_ID: ${matched.join(', ')}`
  );
  if (matched.length === 1) return { STAGE_ID: matched[0] };
  return { '@STAGE_ID': matched };
}

/**
 * Lista itens do SPA (paginado). Usa POST com JSON para suportar `filter` (estágio/coluna).
 */
async function getTasks() {
  if (!BASE_URL) {
    throw new Error('BITRIX_WEBHOOK não definido');
  }

  const etId = await getEntityTypeId();
  const filter = await buildItemListFilter(etId);
  const limit = listPageSize();
  const allItems = [];
  let start = 0;
  const url = `${BASE_URL}/crm.item.list`;

  for (;;) {
    const body = {
      entityTypeId: etId,
      start,
      limit,
    };
    if (filter && Object.keys(filter).length) body.filter = filter;

    let response;
    try {
      response = await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      const flat = {
        entityTypeId: etId,
        start,
        limit,
        ...flattenFilterForGet(filter),
      };
      response = await axios.get(url, { params: flat });
    }

    let msg = restErrorMessage(response.data);
    if (msg) {
      const flat = {
        entityTypeId: etId,
        start,
        limit,
        ...flattenFilterForGet(filter),
      };
      response = await axios.get(url, { params: flat });
      msg = restErrorMessage(response.data);
      if (msg) throw new Error(msg);
    }

    const items = (response.data.result && response.data.result.items) || [];
    allItems.push(...items);
    if (items.length < limit) break;
    start += limit;
    if (start > 200000) break;
  }

  return allItems;
}

/**
 * Converte filter em params GET estilo filter[STAGE_ID]=...
 * @param {Record<string, unknown>} filter
 */
function flattenFilterForGet(filter) {
  if (!filter || typeof filter !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(filter)) {
    if (k === '@STAGE_ID' && Array.isArray(v)) {
      v.forEach((id, i) => {
        out[`filter[@STAGE_ID][${i}]`] = id;
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

async function getTaskDetail(id) {
  const url = `${BASE_URL}/crm.item.get`;
  const etId = await getEntityTypeId();

  const response = await axios.get(url, {
    params: {
      entityTypeId: etId,
      id,
    },
  });

  const msg = restErrorMessage(response.data);
  if (msg) throw new Error(msg);

  return response.data.result.item;
}

async function updateCrmItemFieldsJson(id, fields) {
  const url = `${BASE_URL}/crm.item.update`;
  const etId = await getEntityTypeId();
  return axios.post(url, {
    entityTypeId: etId,
    id,
    fields,
  });
}

async function updateCrmItemFieldsForm(id, fields) {
  const url = `${BASE_URL}/crm.item.update`;
  const etId = await getEntityTypeId();
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

async function updateCrmItemFields(id, fields) {
  if (!BASE_URL) {
    throw new Error('BITRIX_WEBHOOK não definido');
  }

  let response = await updateCrmItemFieldsJson(id, fields);
  logRestDebug('crm.item.update JSON', response);

  let msg = restErrorMessage(response.data);
  if (msg) {
    response = await updateCrmItemFieldsForm(id, fields);
    logRestDebug('crm.item.update form-urlencoded (retry)', response);
    msg = restErrorMessage(response.data);
  }

  if (msg) throw new Error(msg);
  const { result } = response.data;
  if (result === false) {
    throw new Error('crm.item.update retornou result=false');
  }
  return result;
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
  /** @deprecated use getEntityTypeId() — mantido para scripts que esperam número síncrono */
  entityTypeId: entityTypeIdSync,
  getTasks,
  getTaskDetail,
  updateCrmItemFields,
  fetchSpaTypesList,
  getSpaSymbolCodeShortForEntityTypeId,
};
