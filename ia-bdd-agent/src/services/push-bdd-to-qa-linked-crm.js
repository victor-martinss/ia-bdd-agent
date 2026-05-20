require('../../load-env');
const axios = require('axios');
const { getEntityTypeId, getTaskDetail } = require('./bitrix.service');
const {
  pushBddToCrmCenariosQa,
  bddPodePublicarNoCrm,
  bddQaStorageFieldAlreadyFilled,
  bddQaStorageFirstFilledFieldKey,
} = require('./push-bdd-to-crm');
const { itemTemHistoricoQa } = require('./crm-qa-history');
const {
  resolveQaStageIds,
  resolveDevStageIds,
  isQaStageId,
  isDevStageId,
  flattenCrmItem,
  buildStageFilter,
} = require('./crm-qa-stages');

const BASE_URL = process.env.BITRIX_WEBHOOK;

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

/**
 * Busca outros cards do SPA na fila QA com o mesmo vínculo (id externo / id chamado).
 * @param {Record<string, unknown>} flat
 * @param {number} sourceId
 * @param {string[]} qaStageIds
 */
function buildLinkFilters(flat, sourceId) {
  const filters = [];
  const ext = flat.ufCrm94NgfIdExterno;
  const chamado = flat.ufCrm94NgfIdDoChamado;
  const sid = String(sourceId);

  if (ext && String(ext).trim() && String(ext).trim() !== 'N/A') {
    filters.push({ ufCrm94NgfIdExterno: String(ext).trim() });
  }
  if (chamado && String(chamado).trim() && String(chamado).trim() !== 'N/A') {
    filters.push({ ufCrm94NgfIdDoChamado: String(chamado).trim() });
  }
  filters.push({ ufCrm94NgfIdDoChamado: sid });

  return filters;
}

async function listCrmItemsByFilter(entityTypeId, filter) {
  if (!BASE_URL) return [];
  const url = `${BASE_URL}/crm.item.list`;
  const items = [];
  let start = 0;
  for (;;) {
    try {
      const response = await axios.post(
        url,
        { entityTypeId, filter, start, limit: 50, select: ['id', 'stageId', 'title'] },
        { headers: { 'Content-Type': 'application/json' }, validateStatus: () => true }
      );
      if (restErrorMessage(response.data)) break;
      const batch = (response.data.result && response.data.result.items) || [];
      items.push(...batch);
      if (batch.length < 50) break;
      start += 50;
      if (start > 500) break;
    } catch {
      break;
    }
  }
  return items;
}

/**
 * IDs de cards CRM na coluna QA (Teste de Q.A., etc.) ligados ao item de origem.
 * @param {string|number} sourceItemId
 * @param {Record<string, unknown> | null} [detail]
 */
async function listLinkedQaCrmItemIds(sourceItemId, detail = null) {
  const etId = await getEntityTypeId();
  const qaStageIds = await resolveQaStageIds(etId);
  if (!qaStageIds.length) return [];

  const flat = flattenCrmItem(detail || (await getTaskDetail(sourceItemId)));
  const stageFilterRaw = buildStageFilter(qaStageIds);
  const stageFilter = {};
  if (stageFilterRaw.stageId) stageFilter.stageId = stageFilterRaw.stageId;
  else if (stageFilterRaw['@stageId']) stageFilter['@stageId'] = stageFilterRaw['@stageId'];

  const linkFilters = buildLinkFilters(flat, sourceItemId);
  const found = new Map();

  for (const link of linkFilters) {
    const filter = { ...link, ...stageFilter };
    const items = await listCrmItemsByFilter(etId, filter);
    for (const it of items) {
      const id = Number(it.id ?? it.ID);
      if (!Number.isFinite(id) || id === Number(sourceItemId)) continue;
      const stageId = String(it.stageId || it.STAGE_ID || '');
      if (await isQaStageId(stageId, etId)) {
        found.set(id, { id, stageId, title: it.title || it.TITLE });
      }
    }
  }

  return [...found.values()];
}

/**
 * Grava BDD somente em cards CRM na fila QA (não em colunas de desenvolvimento).
 * @param {string|number} sourceItemId
 * @param {string} bdd
 * @param {{ quiet?: boolean, detail?: Record<string, unknown> }} [options]
 */
async function pushBddToQaLinkedCrmItems(sourceItemId, bdd, options = {}) {
  const { quiet = false, detail = null } = options;

  if (process.env.BITRIX_PUSH_BDD_TO_QA_LINKED_CRM === '0') {
    return { skipped: true, reason: 'BITRIX_PUSH_BDD_TO_QA_LINKED_CRM=0', updated: 0, itemIds: [], skippedAlreadyFilled: 0, failed: 0 };
  }
  if (!bddPodePublicarNoCrm(bdd) || !BASE_URL) {
    return { skipped: true, updated: 0, itemIds: [], skippedAlreadyFilled: 0, failed: 0 };
  }

  const etId = await getEntityTypeId();
  const srcDetail = detail || (await getTaskDetail(sourceItemId));
  const srcStage = srcDetail && (srcDetail.stageId || srcDetail.STAGE_ID);
  const inDev = srcStage && (await isDevStageId(String(srcStage), etId));

  if (inDev && process.env.BITRIX_PUSH_BDD_ON_DEV_CARD !== '1') {
    if (!quiet) {
      console.log(
        `[CRM→QA] item ${sourceItemId} está em coluna de desenvolvimento — BDD só em cards QA vinculados (não no card Dev).`
      );
    }
  }

  const qaItems = await listLinkedQaCrmItemIds(sourceItemId, srcDetail);
  if (!qaItems.length) {
    return { skipped: true, reason: 'nenhum card QA vinculado na fila', updated: 0, itemIds: [], skippedAlreadyFilled: 0, failed: 0 };
  }

  let updated = 0;
  const itemIds = [];
  let skippedAlreadyFilled = 0;
  let failedPush = 0;

  for (const row of qaItems) {
    const childDetail = await getTaskDetail(row.id);
    const hist = await itemTemHistoricoQa(childDetail || {});
    if (hist.has) {
      skippedAlreadyFilled += 1;
      if (!quiet) {
        console.log(
          `📎 Card QA ${row.id} (${row.title || 'sem título'}) — histórico QA (retorno); não gera cenários. ${hist.reason}`
        );
      }
      continue;
    }
    if (bddQaStorageFieldAlreadyFilled(childDetail || {})) {
      skippedAlreadyFilled += 1;
      if (!quiet) {
        const fk = bddQaStorageFirstFilledFieldKey(childDetail || {});
        console.log(
          `📎 Card QA ${row.id} (${row.title || 'sem título'}) — campo de cenários QA${fk ? ` (${fk})` : ''} já preenchido (sem zona de atualização IA); não altera cenários já aprovados.`
        );
      }
      continue;
    }
    const r = await pushBddToCrmCenariosQa(row.id, bdd, {
      quiet,
      detail: childDetail || srcDetail,
    });
    if (r.ok) {
      updated += 1;
      itemIds.push(row.id);
      if (!quiet) {
        console.log(
          `📝 Card QA ${row.id} (${row.title || 'sem título'}) ← cenários gravados em ${r.field || 'campo QA (BITRIX_UF_BDD_FIELD)'}`
        );
      }
    } else {
      failedPush += 1;
    }
  }

  return {
    ok: updated > 0,
    updated,
    itemIds,
    skippedAlreadyFilled,
    failed: failedPush,
  };
}

module.exports = {
  listLinkedQaCrmItemIds,
  pushBddToQaLinkedCrmItems,
};
