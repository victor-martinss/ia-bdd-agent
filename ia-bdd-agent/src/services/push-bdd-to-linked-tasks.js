require('../../load-env');
const axios = require('axios');
const {
  getEntityTypeId,
  getTaskDetail,
  getSpaSymbolCodeShortForEntityTypeId,
  entityTypeIdCandidatesForItem,
} = require('./bitrix.service');
const {
  truncarParaCampoUf,
  bddPodePublicarNoCrm,
  pushBddToCrmCenariosQa,
} = require('./push-bdd-to-crm');

const BASE_URL = process.env.BITRIX_WEBHOOK;

const TASK_LIST_PAGE = 50;

let warnedMissingTaskUf = false;

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

function normalizeTasksFromListResponse(data) {
  const result = data && data.result;
  if (!result) return [];
  const tasks = result.tasks;
  if (Array.isArray(tasks)) return tasks;
  if (tasks && typeof tasks === 'object') return Object.values(tasks);
  return [];
}

const AXIOS_TASK_OPTS = {
  headers: { 'Content-Type': 'application/json' },
  validateStatus: (s) => s >= 200 && s < 500,
};

function bitrixHttpDetail(response, err) {
  if (err && err.response && err.response.data) {
    const d = err.response.data;
    return (
      (d.error_description && String(d.error_description)) ||
      (d.error && String(d.error)) ||
      err.message
    );
  }
  if (response && response.data) return restErrorMessage(response.data);
  return err ? err.message || String(err) : '';
}

/**
 * POST tasks.task.list com corpo aceito pelo Bitrix (order + filter + select).
 */
async function postTasksTaskList(body) {
  const url = `${BASE_URL}/tasks.task.list`;
  const payload = {
    order: { ID: 'DESC' },
    select: ['ID', 'UF_CRM_TASK'],
    start: 0,
    ...body,
  };
  if (!payload.order) payload.order = { ID: 'DESC' };
  if (!payload.select || !payload.select.length) {
    payload.select = ['ID', 'UF_CRM_TASK'];
  }

  const response = await axios.post(url, payload, AXIOS_TASK_OPTS);
  const msg = bitrixHttpDetail(response);
  if (response.status >= 400 || msg) {
    return { ok: false, error: msg || `HTTP ${response.status}`, tasks: [] };
  }
  return { ok: true, tasks: normalizeTasksFromListResponse(response.data) };
}

/**
 * Valores possíveis de UF_CRM_TASK que ligam a tarefa ao item do SPA.
 * @param {number} entityTypeId
 * @param {string|number} crmItemId
 * @param {string | null} symbolShort ex.: T82 (crm.type.list)
 */
function bindingCandidates(entityTypeId, crmItemId, symbolShort) {
  const id = String(crmItemId);
  const et = String(entityTypeId);
  const c = [];
  const tpl = (process.env.BITRIX_UF_CRM_TASK_VALUE || '').trim();
  if (tpl) {
    c.push(
      tpl
        .replace(/\{\{\s*id\s*\}\}/gi, id)
        .replace(/\{\{\s*entityTypeId\s*\}\}/gi, et)
        .replace(/\{\{\s*symbol\s*\}\}/gi, symbolShort ? String(symbolShort) : '')
    );
  }
  const envSym = (process.env.BITRIX_SYMBOL_CODE_SHORT || '').trim();
  if (envSym) c.push(`${envSym}_${id}`);
  if (symbolShort) c.push(`${symbolShort}_${id}`);
  c.push(`T${et}_${id}`);
  c.push(`CRM_DYNAMIC_${et}_${id}`);
  c.push(`DYNAMIC_${et}_${id}`);
  return [...new Set(c.filter(Boolean))];
}

function flattenCrmItem(detail) {
  if (!detail || typeof detail !== 'object') return {};
  if (detail.fields && typeof detail.fields === 'object') {
    return { ...detail, ...detail.fields };
  }
  return detail;
}

/** Extrai vínculos UF_CRM_TASK e IDs numéricos de tarefa a partir do item do CRM. */
function extractBindingsFromCrmDetail(detail, entityTypeId, crmItemId, symbolShort) {
  const flat = flattenCrmItem(detail);
  const bindings = new Set(bindingCandidates(entityTypeId, crmItemId, symbolShort));
  const taskIds = new Set();
  const idStr = String(crmItemId);
  const etStr = String(entityTypeId);

  const bindingRe =
    /(?:CRM_DYNAMIC|DYNAMIC|T[A-Z0-9]*)_?\d*_\d+|[A-Z]\d+_\d+/gi;

  const considerString = (s) => {
    if (!s || typeof s !== 'string') return;
    const t = s.trim();
    if (!t) return;
    let m;
    const re = new RegExp(bindingRe.source, 'gi');
    while ((m = re.exec(t)) !== null) {
      const token = m[0].toUpperCase().replace(/^T(\d+)_/, 'T$1_');
      bindings.add(m[0]);
      bindings.add(token);
      const parts = m[0].split('_');
      const last = parts[parts.length - 1];
      if (last === idStr) bindings.add(m[0]);
    }
    if (/^\d{2,9}$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n) && n > 0) taskIds.add(n);
    }
  };

  const walk = (val, keyHint = '') => {
    if (val == null) return;
    if (Array.isArray(val)) {
      val.forEach((v) => walk(v, keyHint));
      return;
    }
    if (typeof val === 'object') {
      for (const [k, v] of Object.entries(val)) walk(v, k);
      return;
    }
    const s = String(val);
    considerString(s);
    const kl = keyHint.toLowerCase();
    const pareceIdDeTarefa =
      /^(task_?id|id_?task|bitrix_?task|linked_?task|tarefa_?id)$/i.test(kl) ||
      (kl.includes('task') && kl.includes('id') && !kl.includes('crm'));
    if (pareceIdDeTarefa) {
      const n = Number.parseInt(s, 10);
      if (Number.isFinite(n) && n > 0 && n !== Number(crmItemId)) taskIds.add(n);
    }
  };

  walk(flat);

  return { bindings: [...bindings], taskIds: [...taskIds] };
}

function taskUfCrmTaskValues(task) {
  const raw = task.UF_CRM_TASK ?? task.ufCrmTask ?? task.uf_crm_task;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return [String(raw)];
}

function taskMatchesBindings(task, bindingSet) {
  const vals = taskUfCrmTaskValues(task);
  for (const v of vals) {
    if (bindingSet.has(v)) return true;
    const upper = v.toUpperCase();
    for (const b of bindingSet) {
      if (upper === String(b).toUpperCase()) return true;
    }
  }
  return false;
}

async function listTaskIdsForUfCrmBinding(ufVal) {
  if (!ufVal || !String(ufVal).trim()) return [];
  const ids = new Set();
  let start = 0;
  let lastErr = '';

  for (;;) {
    let batch = [];
    const filters = [{ UF_CRM_TASK: ufVal }];
    if (String(ufVal).includes('_')) {
      filters.push({ UF_CRM_TASK: String(ufVal).toUpperCase() });
    }

    for (const filter of filters) {
      try {
        const r = await postTasksTaskList({ filter, start });
        if (!r.ok) {
          lastErr = r.error || lastErr;
          continue;
        }
        batch = r.tasks;
        if (batch.length) break;
      } catch (e) {
        lastErr = e.message || String(e);
      }
    }

    if (!batch.length) {
      if (lastErr && process.env.DEBUG_BITRIX === '1') {
        console.warn(`[CRM→Tarefas] tasks.task.list (${ufVal}):`, lastErr);
      }
      break;
    }

    for (const t of batch) {
      const tid = Number(t.id ?? t.ID);
      if (Number.isFinite(tid)) ids.add(tid);
    }
    if (batch.length < TASK_LIST_PAGE) break;
    start += TASK_LIST_PAGE;
    if (start >= TASK_LIST_PAGE) break;
  }
  return [...ids];
}

async function filterTasksLinkedToCrm(taskIds, bindingSet) {
  const linked = [];
  const max = Number.parseInt(process.env.BITRIX_LINKED_TASKS_MAX_VERIFY || '15', 10) || 15;
  for (const tid of taskIds.slice(0, max)) {
    if (await verifyTaskLinkedToCrm(tid, bindingSet)) linked.push(tid);
  }
  return linked;
}

/**
 * Tarefas na timeline do CRM (somente OWNER_ID = item, sem BINDINGS genérico).
 */
async function listTaskIdsViaCrmActivity(entityTypeId, crmItemId, bindingSet) {
  if (!BASE_URL) return [];
  const url = `${BASE_URL}/crm.activity.list`;
  const ownerTypes = [
    `DYNAMIC_${entityTypeId}`,
    `CRM_DYNAMIC_${entityTypeId}`,
    `T${entityTypeId}`,
  ];
  const rawIds = new Set();

  for (const ownerType of ownerTypes) {
    try {
      const response = await axios.post(
        url,
        {
          order: { ID: 'DESC' },
          filter: {
            OWNER_TYPE_ID: ownerType,
            OWNER_ID: Number(crmItemId),
          },
          select: ['ID', 'ASSOCIATED_ENTITY_ID', 'PROVIDER_ID'],
          start: 0,
        },
        AXIOS_TASK_OPTS
      );
      const msg = bitrixHttpDetail(response);
      if (response.status >= 400 || msg) continue;

      const items = (response.data.result || []).filter(Boolean);
      for (const act of items) {
        const prov = String(act.PROVIDER_ID || act.providerId || '').toUpperCase();
        if (prov && !prov.includes('TASK')) continue;
        const tid = Number(act.ASSOCIATED_ENTITY_ID ?? act.associatedEntityId);
        if (Number.isFinite(tid) && tid > 0) rawIds.add(tid);
      }
    } catch {
      /* próximo ownerType */
    }
  }

  return filterTasksLinkedToCrm([...rawIds], bindingSet);
}

async function verifyTaskLinkedToCrm(taskId, bindingSet) {
  const task = await getTaskPayload(taskId, ['ID', 'UF_CRM_TASK']);
  if (!task) return false;
  return taskMatchesBindings(task, bindingSet);
}

/**
 * @param {string|number} crmItemId
 * @param {Record<string, unknown> | null | undefined} [crmDetail]
 */
async function listLinkedTaskIdsForCrmItem(crmItemId, crmDetail = null) {
  try {
    const etId = await getEntityTypeId();
    let sym = null;
    try {
      sym = await getSpaSymbolCodeShortForEntityTypeId(etId);
    } catch {
      sym = null;
    }

    const baseBindings = bindingCandidates(etId, crmItemId, sym);
    const bindingSet = new Set(baseBindings);
    const all = new Set();

    if (crmDetail) {
      const extracted = extractBindingsFromCrmDetail(
        crmDetail,
        etId,
        crmItemId,
        sym
      );
      extracted.bindings.forEach((b) => bindingSet.add(b));
      const hinted = await filterTasksLinkedToCrm(extracted.taskIds, bindingSet);
      hinted.forEach((id) => all.add(id));
    }

    for (const ufVal of bindingSet) {
      const ids = await listTaskIdsForUfCrmBinding(ufVal);
      const linked = await filterTasksLinkedToCrm(ids, bindingSet);
      linked.forEach((id) => all.add(id));
    }

    if (!all.size) {
      const viaActivity = await listTaskIdsViaCrmActivity(etId, crmItemId, bindingSet);
      viaActivity.forEach((id) => all.add(id));
    }

    return [...all];
  } catch (e) {
    if (process.env.DEBUG_BITRIX === '1') {
      console.warn('[CRM→Tarefas] listLinkedTaskIdsForCrmItem:', e.message || e);
    }
    return [];
  }
}

/**
 * Itens filhos do SPA (parentId{entityTypeId}) — outra forma de "tarefa atrelada".
 */
async function listChildCrmItemIdsForParent(parentItemId, entityTypeId) {
  if (!BASE_URL) return [];
  const parentKey = `parentId${entityTypeId}`;
  const filters = [
    { [parentKey]: parentItemId },
    { [`=${parentKey}`]: parentItemId },
    { parentId: parentItemId },
  ];
  const ids = new Set();
  const url = `${BASE_URL}/crm.item.list`;

  for (const filter of filters) {
    let start = 0;
    for (;;) {
      try {
        const response = await axios.post(
          url,
          { entityTypeId, filter, start, limit: 50 },
          { headers: { 'Content-Type': 'application/json' } }
        );
        if (restErrorMessage(response.data)) break;
        const items = (response.data.result && response.data.result.items) || [];
        for (const it of items) {
          const id = Number(it.id ?? it.ID);
          if (Number.isFinite(id) && id !== Number(parentItemId)) ids.add(id);
        }
        if (items.length < 50) break;
        start += 50;
      } catch {
        break;
      }
    }
    if (ids.size) break;
  }
  return [...ids];
}

/**
 * Grava BDD nos itens CRM filhos (mesmo campo Teste Q.A. / Cenários QA do card principal).
 */
async function pushBddToLinkedCrmChildItems(crmItemId, bdd, options = {}) {
  const { quiet = false, detail = null } = options;

  if (process.env.BITRIX_PUSH_BDD_TO_LINKED_CRM_ITEMS === '0') {
    return { skipped: true, reason: 'BITRIX_PUSH_BDD_TO_LINKED_CRM_ITEMS=0', updated: 0, itemIds: [] };
  }
  if (!bddPodePublicarNoCrm(bdd) || !BASE_URL) {
    return { skipped: true, updated: 0, itemIds: [] };
  }

  const srcDetail = detail || (await getTaskDetail(crmItemId));
  const childIdSet = new Set();
  for (const etId of entityTypeIdCandidatesForItem(srcDetail)) {
    for (const id of await listChildCrmItemIdsForParent(crmItemId, etId)) {
      childIdSet.add(id);
    }
  }
  const childIds = [...childIdSet];
  if (!childIds.length) {
    return { skipped: true, reason: 'nenhum item CRM filho', updated: 0, itemIds: [] };
  }

  let updated = 0;
  for (const childId of childIds) {
    const r = await pushBddToCrmCenariosQa(childId, bdd, {
      quiet,
      detail,
      linkedSync: true,
    });
    if (r.ok) {
      updated += 1;
      if (!quiet) {
        console.log(`📝 Item CRM filho ${childId} atualizado ← pai ${crmItemId}`);
      }
    }
  }
  return { ok: updated > 0, updated, itemIds: childIds, failed: childIds.length - updated };
}

async function updateTaskFields(taskId, fields) {
  const url = `${BASE_URL}/tasks.task.update`;
  const response = await axios.post(
    url,
    { taskId, fields },
    AXIOS_TASK_OPTS
  );
  const msg = bitrixHttpDetail(response);
  if (response.status >= 400 || msg) throw new Error(msg || `HTTP ${response.status}`);
  return response.data.result;
}

/**
 * @param {string|number} taskId
 * @param {string[] | null} [select] campos a pedir (UFs). Se omitido, o Bitrix devolve o conjunto padrão.
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function getTaskPayload(taskId, select = null) {
  const url = `${BASE_URL}/tasks.task.get`;
  try {
    const body = { taskId: Number(taskId) };
    if (select && select.length) body.select = select;
    const response = await axios.post(url, body, AXIOS_TASK_OPTS);
    const msg = bitrixHttpDetail(response);
    if (response.status >= 400 || msg) return null;
    const r = response.data.result;
    if (Array.isArray(r) && !r.length) return null;
    const task = (r && (r.task || r.TASK)) || r;
    return task && typeof task === 'object' && !Array.isArray(task) ? task : null;
  } catch {
    return null;
  }
}

/** UF de tarefa candidato a receber BDD (exclui UF_CRM_TASK de vínculo). */
function matchesTaskBddUfKey(k) {
  const lower = k.toLowerCase();
  if (lower === 'uf_crm_task') return false;
  if (!(k.startsWith('uf') || k.startsWith('UF'))) return false;
  if (lower.startsWith('ufcrm')) return false;
  const compact = lower.replace(/[^a-z0-9]/g, '');
  if (compact.includes('testeqa')) return true;
  if (lower.includes('teste') && lower.includes('qa')) return true;
  if (lower.includes('cenario') && lower.includes('qa')) return true;
  if (lower.includes('scenario') && lower.includes('qa')) return true;
  return false;
}

function taskBddFieldKeyPriority(k) {
  const lower = k.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, '');
  if (compact.includes('testeqa')) return 0;
  if (lower.includes('teste') && lower.includes('qa')) return 0;
  if (lower.includes('cenario') && lower.includes('qa')) return 1;
  if (lower.includes('scenario') && lower.includes('qa')) return 1;
  return 2;
}

/**
 * Descobre chaves UF na resposta de tasks.task.get (mesma ideia do item do CRM).
 * @param {Record<string, unknown> | null | undefined} task
 */
function discoverTaskBddFieldKeys(task) {
  if (!task || typeof task !== 'object') return [];
  const keys = Object.keys(task).filter(matchesTaskBddUfKey);
  const uniq = [...new Set(keys)];
  uniq.sort((a, b) => taskBddFieldKeyPriority(a) - taskBddFieldKeyPriority(b));
  return uniq;
}

function taskBddFieldKeysFromEnv() {
  const fromTask = (process.env.BITRIX_TASK_UF_BDD_FIELD || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const fromCrm = [
    process.env.BITRIX_UF_BDD_FIELD,
    process.env.BITRIX_UF_CENARIOS_QA,
    process.env.BITRIX_UF_TESTE_QA,
    'ufCrm100CenariosQa',
    'ufCrm100TesteQa',
    'ufCrm94CenariosQa',
    'ufCrm94TesteQa',
  ]
    .filter(Boolean)
    .map((s) => String(s).trim());
  return [...new Set([...fromTask, ...fromCrm])];
}

function taskAutoDiscoverEnabled() {
  return process.env.BITRIX_TASK_UF_AUTO_DISCOVER !== '0';
}

/**
 * Lista de campos UF a tentar na tarefa: .env primeiro; senão descobre na primeira tarefa.
 * @param {number[]} linkedTaskIds
 */
async function resolveFieldKeysForLinkedTasks(linkedTaskIds) {
  const fromEnv = taskBddFieldKeysFromEnv();
  if (fromEnv.length) return [...new Set(fromEnv)];

  if (!taskAutoDiscoverEnabled() || !linkedTaskIds.length) return [];

  const sample = await getTaskPayload(linkedTaskIds[0]);
  let discovered = discoverTaskBddFieldKeys(sample);
  if (!discovered.length) {
    const extra = (process.env.BITRIX_TASK_GET_SELECT || '')
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (extra.length) {
      const sample2 = await getTaskPayload(linkedTaskIds[0], extra);
      discovered = discoverTaskBddFieldKeys(sample2);
    }
  }
  if (discovered.length) return discovered;

  return [];
}

/**
 * Grava o mesmo BDD nas tarefas do Bitrix atreladas ao item do CRM (UF_CRM_TASK).
 * Desligar: BITRIX_PUSH_BDD_TO_LINKED_TASKS=0
 * Campo na tarefa: BITRIX_TASK_UF_BDD_FIELD (opcional). Se vazio, usa descoberta em
 * tasks.task.get (Teste Q.A. / Cenários QA) salvo BITRIX_TASK_UF_AUTO_DISCOVER=0.
 *
 * @param {string|number} crmItemId id do item no SPA (crm.item.*)
 * @param {string} bdd
 * @param {{ quiet?: boolean, detail?: Record<string, unknown> | null }} [options]
 */
async function pushBddToLinkedBitrixTasks(crmItemId, bdd, options = {}) {
  const { quiet = false, detail = null } = options;

  if (process.env.BITRIX_PUSH_BDD_TO_LINKED_TASKS === '0') {
    return {
      skipped: true,
      reason: 'BITRIX_PUSH_BDD_TO_LINKED_TASKS=0',
      updated: 0,
      taskIds: [],
    };
  }

  if (!bddPodePublicarNoCrm(bdd)) {
    return {
      skipped: true,
      reason: 'bdd inválido',
      updated: 0,
      taskIds: [],
    };
  }

  if (!BASE_URL) {
    return { skipped: true, reason: 'BITRIX_WEBHOOK', updated: 0, taskIds: [] };
  }

  const valor = truncarParaCampoUf(bdd.trim());
  const taskIds = await listLinkedTaskIdsForCrmItem(crmItemId, detail);

  if (!taskIds.length) {
    if (!quiet) {
      console.log(
        `[CRM→Tarefas] item ${crmItemId}: nenhuma tarefa Bitrix vinculada encontrada (confira UF_CRM_TASK na tarefa ou defina BITRIX_UF_CRM_TASK_VALUE={{symbol}}_{{id}}).`
      );
    }
    return { skipped: true, reason: 'nenhuma tarefa vinculada', updated: 0, taskIds: [] };
  }

  const fieldKeys = await resolveFieldKeysForLinkedTasks(taskIds);
  if (!fieldKeys.length) {
    if (!warnedMissingTaskUf && !quiet) {
      warnedMissingTaskUf = true;
      console.log(
        '[CRM→Tarefas] Há tarefas vinculadas, mas nenhum UF de cenários encontrado: defina BITRIX_TASK_UF_BDD_FIELD ou deixe BITRIX_TASK_UF_AUTO_DISCOVER=1 (padrão) com UF visível em tasks.task.get. Desligar tudo: BITRIX_PUSH_BDD_TO_LINKED_TASKS=0'
      );
    }
    return {
      skipped: true,
      reason: 'sem UF de destino na tarefa',
      updated: 0,
      taskIds,
    };
  }

  if (!quiet && process.env.DEBUG_BITRIX === '1' && !taskBddFieldKeysFromEnv().length && fieldKeys.length) {
    console.log(
      `[CRM→Tarefas] UFs candidatos (auto): ${fieldKeys.join(', ')} — item CRM ${crmItemId}`
    );
  }

  let updated = 0;
  let lastErr = '';
  for (const tid of taskIds) {
    let okTask = false;
    for (const fk of fieldKeys) {
      try {
        await updateTaskFields(tid, { [fk]: valor });
        okTask = true;
        updated += 1;
        if (!quiet) {
          console.log(`📝 Tarefa Bitrix ${tid} atualizada (${fk}) ← item CRM ${crmItemId}`);
        }
        break;
      } catch (e) {
        lastErr = e.message || String(e);
      }
    }
    if (!okTask && !quiet) {
      console.warn(
        `[CRM→Tarefas] tarefa ${tid}: falha ao gravar (${fieldKeys.join(', ')}): ${lastErr}`
      );
    }
  }

  return {
    ok: updated > 0,
    updated,
    taskIds,
    failed: taskIds.length - updated,
  };
}

module.exports = {
  pushBddToLinkedBitrixTasks,
  pushBddToLinkedCrmChildItems,
  listLinkedTaskIdsForCrmItem,
  listChildCrmItemIdsForParent,
  bindingCandidates,
  extractBindingsFromCrmDetail,
  discoverTaskBddFieldKeys,
  getTaskPayload,
};
