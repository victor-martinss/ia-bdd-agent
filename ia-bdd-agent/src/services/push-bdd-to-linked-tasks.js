require('../../load-env');
const axios = require('axios');
const {
  getEntityTypeId,
  getSpaSymbolCodeShortForEntityTypeId,
} = require('./bitrix.service');
const { truncarParaCampoUf, bddPodePublicarNoCrm } = require('./push-bdd-to-crm');

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
  if (symbolShort) c.push(`${symbolShort}_${id}`);
  c.push(`T${et}_${id}`);
  c.push(`CRM_DYNAMIC_${et}_${id}`);
  c.push(`DYNAMIC_${et}_${id}`);
  return [...new Set(c.filter(Boolean))];
}

async function listTaskIdsForUfCrmBinding(ufVal) {
  const ids = new Set();
  let start = 0;
  for (;;) {
    const url = `${BASE_URL}/tasks.task.list`;
    const bases = [{ UF_CRM_TASK: ufVal }, { '=UF_CRM_TASK': ufVal }];
    let batch = [];
    for (const filter of bases) {
      try {
        const response = await axios.post(
          url,
          {
            filter,
            select: ['ID', 'UF_CRM_TASK'],
            start,
          },
          { headers: { 'Content-Type': 'application/json' } }
        );
        if (restErrorMessage(response.data)) continue;
        batch = normalizeTasksFromListResponse(response.data);
        if (batch.length) break;
      } catch {
        /* tenta outro filtro */
      }
    }
    if (!batch.length) break;
    for (const t of batch) {
      const tid = Number(t.id ?? t.ID);
      if (Number.isFinite(tid)) ids.add(tid);
    }
    if (batch.length < TASK_LIST_PAGE) break;
    start += TASK_LIST_PAGE;
  }
  return [...ids];
}

async function listLinkedTaskIdsForCrmItem(crmItemId) {
  const etId = await getEntityTypeId();
  const sym = await getSpaSymbolCodeShortForEntityTypeId(etId);
  const cands = bindingCandidates(etId, crmItemId, sym);
  const all = new Set();
  for (const ufVal of cands) {
    const ids = await listTaskIdsForUfCrmBinding(ufVal);
    ids.forEach((id) => all.add(id));
  }
  return [...all];
}

async function updateTaskFields(taskId, fields) {
  const url = `${BASE_URL}/tasks.task.update`;
  const response = await axios.post(
    url,
    { taskId, fields },
    { headers: { 'Content-Type': 'application/json' } }
  );
  const msg = restErrorMessage(response.data);
  if (msg) throw new Error(msg);
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
    const response = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
    });
    const msg = restErrorMessage(response.data);
    if (msg) return null;
    const r = response.data.result;
    const task = (r && (r.task || r.TASK)) || r;
    return task && typeof task === 'object' ? task : null;
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
  return (process.env.BITRIX_TASK_UF_BDD_FIELD || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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
 * @param {{ quiet?: boolean }} [options]
 */
async function pushBddToLinkedBitrixTasks(crmItemId, bdd, options = {}) {
  const { quiet = false } = options;

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
  let taskIds;
  try {
    taskIds = await listLinkedTaskIdsForCrmItem(crmItemId);
  } catch (e) {
    if (!quiet) {
      console.warn(
        `[CRM→Tarefas] item ${crmItemId}: falha ao listar tarefas —`,
        e.message || e
      );
    }
    return {
      ok: false,
      error: e.message || String(e),
      updated: 0,
      taskIds: [],
    };
  }

  if (!taskIds.length) {
    if (process.env.DEBUG_BITRIX === '1' && !quiet) {
      console.log(
        `[CRM→Tarefas] item ${crmItemId}: nenhuma tarefa com UF_CRM_TASK reconhecido (tente BITRIX_UF_CRM_TASK_VALUE).`
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
  listLinkedTaskIdsForCrmItem,
  bindingCandidates,
  discoverTaskBddFieldKeys,
  getTaskPayload,
};
