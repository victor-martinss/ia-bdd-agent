require('../../load-env');
const axios = require('axios');
const { getTaskDetail, entityTypeIdCandidatesForItem } = require('./bitrix.service');
const {
  pushBddToCrmCenariosQa,
  bddPodePublicarNoCrm,
  classifyBddQaItemAction,
  bddQaStorageFirstFilledFieldKey,
  qaBddFieldTextFromFlat,
} = require('./push-bdd-to-crm');
const { flattenItem } = require('../agents/parser');
const {
  linkedCardNeedsBddSync,
  contarCenariosGherkin,
} = require('../utils/bdd-canonical-for-linked');
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
function pickLinkFieldValues(flat, suffixes) {
  const out = [];
  if (!flat || typeof flat !== 'object') return out;
  for (const key of Object.keys(flat)) {
    if (!/^ufCrm\d+/i.test(key)) continue;
    const lower = key.toLowerCase();
    if (!suffixes.some((s) => lower.includes(s))) continue;
    const v = flat[key];
    if (v == null || v === '') continue;
    const t = String(v).trim();
    if (!t || t === 'N/A') continue;
    out.push({ key, value: t });
  }
  return out;
}

const CROSS_SPA_LINK_FIELDS = {
  externo: ['ufCrm94NgfIdExterno', 'ufCrm100NgfIdExterno'],
  chamado: ['ufCrm94NgfIdDoChamado', 'ufCrm100NgfIdDoChamado'],
};

function buildLinkFilters(flat, sourceId) {
  const filters = [];
  const sid = String(sourceId);

  const externo = pickLinkFieldValues(flat, ['idexterno', 'id_externo']);
  const chamado = pickLinkFieldValues(flat, ['iddochamado', 'id_do_chamado', 'idchamado']);

  const externoVals = new Set(externo.map((e) => e.value));
  for (const val of externoVals) {
    for (const key of CROSS_SPA_LINK_FIELDS.externo) {
      filters.push({ [key]: val });
    }
  }

  const chamadoVals = new Set(chamado.map((e) => e.value));
  for (const val of chamadoVals) {
    for (const key of CROSS_SPA_LINK_FIELDS.chamado) {
      filters.push({ [key]: val });
    }
  }

  for (const key of CROSS_SPA_LINK_FIELDS.chamado) {
    filters.push({ [key]: sid });
  }

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
  const srcDetail = detail || (await getTaskDetail(sourceItemId));
  const flat = flattenCrmItem(srcDetail);
  const entityTypeIds = entityTypeIdCandidatesForItem(srcDetail);
  const linkFilters = buildLinkFilters(flat, sourceItemId);
  const found = new Map();

  const searchWithoutStageFilter =
    process.env.BITRIX_LINKED_QA_SEARCH_WITHOUT_STAGE_FILTER !== '0';

  for (const etId of entityTypeIds) {
    const qaStageIds = await resolveQaStageIds(etId);
    if (!qaStageIds.length && !searchWithoutStageFilter) continue;

    let stageFilter = {};
    if (!searchWithoutStageFilter) {
      const stageFilterRaw = buildStageFilter(qaStageIds);
      if (stageFilterRaw.stageId) stageFilter = { stageId: stageFilterRaw.stageId };
      else if (stageFilterRaw['@stageId']) stageFilter = { '@stageId': stageFilterRaw['@stageId'] };
    }

    for (const link of linkFilters) {
      const filter = { ...link, ...stageFilter };
      const items = await listCrmItemsByFilter(etId, filter);
      for (const it of items) {
        const id = Number(it.id ?? it.ID);
        if (!Number.isFinite(id) || id === Number(sourceItemId)) continue;
        const stageId = String(it.stageId || it.STAGE_ID || '');
        if (stageId && (await isDevStageId(stageId, etId))) continue;
        const exigeEstagioQa = process.env.BITRIX_LINKED_QA_REQUIRE_QA_STAGE === '1';
        if (exigeEstagioQa && stageId && !(await isQaStageId(stageId, etId))) {
          continue;
        }
        found.set(`${etId}:${id}`, {
          id,
          entityTypeId: etId,
          stageId,
          title: it.title || it.TITLE,
        });
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
    return {
      skipped: true,
      reason: !bddPodePublicarNoCrm(bdd)
        ? 'BDD sem cenários válidos para gravar'
        : 'BITRIX_WEBHOOK ausente',
      updated: 0,
      itemIds: [],
      skippedAlreadyFilled: 0,
      failed: 0,
    };
  }

  const srcDetail = detail || (await getTaskDetail(sourceItemId));
  const srcEtId =
    Number.parseInt(
      String(srcDetail._entityTypeId || srcDetail.entityTypeId || ''),
      10
    ) || entityTypeIdCandidatesForItem(srcDetail)[0];
  const srcStage = srcDetail && (srcDetail.stageId || srcDetail.STAGE_ID);
  const inDev = srcStage && srcEtId && (await isDevStageId(String(srcStage), srcEtId));

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
    const childDetail = await getTaskDetail(row.id, {
      entityTypeId: row.entityTypeId,
    });
    const classification = classifyBddQaItemAction(childDetail || {});
    const flatChild = flattenItem(childDetail || {});
    const { text: linkedExisting } = qaBddFieldTextFromFlat(flatChild);
    const precisaSync = linkedCardNeedsBddSync(linkedExisting, bdd);

    if (
      !precisaSync &&
      (classification.action === 'skip_filled' ||
        classification.action === 'skip_qa_history')
    ) {
      skippedAlreadyFilled += 1;
      if (!quiet) {
        const fk =
          classification.fieldKey ||
          bddQaStorageFirstFilledFieldKey(childDetail || {});
        console.log(
          `📎 Card QA ${row.id} (${row.title || 'sem título'}) — ${classification.reason}${fk ? ` (${fk})` : ''}`
        );
      }
      continue;
    }

    if (!quiet && precisaSync && classification.action === 'skip_filled') {
      const nL = contarCenariosGherkin(linkedExisting);
      const nC = contarCenariosGherkin(bdd);
      console.log(
        `📎 Card QA ${row.id}: sincronizando BDD do pai (${nL} → ${nC} cenário(s))`
      );
    }

    const r = await pushBddToCrmCenariosQa(row.id, bdd, {
      quiet,
      detail: childDetail || srcDetail,
      entityTypeId: row.entityTypeId,
      linkedSync: true,
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
