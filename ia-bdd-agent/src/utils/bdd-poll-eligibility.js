/**
 * Elegibilidade do poll:
 * - Card atrelado (fila / destino QA): coluna "Novo Teste" + Cenários QA vazio
 * - Card pai (URL do feature): coluna "Teste de Q.A." (campo QA do pai não bloqueia gravação no atrelado)
 */
const { flattenItem } = require('../agents/parser');
const {
  classifyBddQaItemAction,
  qaBddFieldTextFromFlat,
} = require('../services/push-bdd-to-crm');
const { listLinkedQaCrmItemIds } = require('../services/push-bdd-to-qa-linked-crm');
const { parentIdFromItem } = require('../services/crm-item-links');
const { extractCrmUrlRefsFromFlat } = require('./crm-item-ref');
const {
  isNovoTesteStageId,
  isTesteDeQaStageId,
  stageDisplayName,
  resolveAllStagesDetailed,
} = require('../services/crm-qa-stages');
const { discoverBddLinkedTargets, shouldPushBddToMainCard, pushTargetMode } = require('./bdd-push-routing');
const {
  pollOnlyNovoTesteEnabled,
  linkedQaMustBeEmptyEnabled,
  parentMustBeTesteQaEnabled,
} = require('./bdd-poll-rules');

function qaFieldFilled(detail) {
  const cls = classifyBddQaItemAction(detail || {});
  return cls.action === 'skip_filled' || cls.action === 'skip_qa_history';
}

/**
 * Card pai vinculado (ex.: SPA 1272 via URL no UF).
 * @returns {Promise<{ id: number, entityTypeId: number, detail?: object } | null>}
 */
async function resolveParentPrincipalCard(sourceItemId, detail) {
  const flat = flattenItem(detail || {});
  const sourceEt =
    Number.parseInt(String(flat._entityTypeId || flat.entityTypeId || ''), 10) || null;
  const sourceNum = Number.parseInt(String(sourceItemId), 10);

  const refs = extractCrmUrlRefsFromFlat(flat);
  for (const ref of refs) {
    if (ref.itemId === sourceNum && ref.entityTypeId === sourceEt) continue;
    const { getTaskDetail } = require('../services/bitrix.service');
    try {
      const parentDetail = await getTaskDetail(ref.itemId, {
        entityTypeId: ref.entityTypeId,
      });
      return {
        id: ref.itemId,
        entityTypeId: ref.entityTypeId,
        detail: parentDetail,
      };
    } catch {
      return { id: ref.itemId, entityTypeId: ref.entityTypeId, detail: null };
    }
  }

  if (sourceEt) {
    const parentId = parentIdFromItem(flat, sourceEt);
    if (parentId && parentId !== sourceNum) {
      const { getTaskDetail } = require('../services/bitrix.service');
      try {
        const parentDetail = await getTaskDetail(parentId, { entityTypeId: sourceEt });
        return { id: parentId, entityTypeId: sourceEt, detail: parentDetail };
      } catch {
        return { id: parentId, entityTypeId: sourceEt, detail: null };
      }
    }
  }

  return null;
}

/**
 * Estado dos cards QA atrelados (destino da gravação).
 */
async function linkedQaFillState(sourceItemId, detail) {
  const rows = await listLinkedQaCrmItemIds(sourceItemId, detail);
  const items = [];
  const filled = [];
  const empty = [];
  const wrongStage = [];

  for (const row of rows) {
    const { getTaskDetail } = require('../services/bitrix.service');
    let childDetail = null;
    try {
      childDetail = await getTaskDetail(row.id, { entityTypeId: row.entityTypeId });
    } catch {
      items.push({
        id: row.id,
        entityTypeId: row.entityTypeId,
        title: row.title,
        qaFilled: false,
        isNovoTeste: false,
        stageId: row.stageId || '',
        stageLabel: '',
      });
      empty.push(row);
      continue;
    }

    const flat = flattenItem(childDetail || {});
    const { key } = qaBddFieldTextFromFlat(flat);
    const qaFilled = qaFieldFilled(childDetail);
    const stageId = String(childDetail.stageId || childDetail.STAGE_ID || row.stageId || '');
    const isNovo = stageId
      ? await isNovoTesteStageId(stageId, row.entityTypeId)
      : false;
    const stageLabel = stageId ? await stageDisplayName(stageId, row.entityTypeId) : '';

    const entry = {
      id: row.id,
      entityTypeId: row.entityTypeId,
      fieldKey: key,
      title: row.title || childDetail?.title || childDetail?.TITLE,
      qaFilled,
      isNovoTeste: isNovo,
      stageId,
      stageLabel,
    };
    items.push(entry);

    if (qaFilled) filled.push(entry);
    else {
      empty.push(entry);
      if (stageId && !isNovo) wrongStage.push(entry);
    }
  }

  return {
    linkedRows: rows,
    items,
    filled,
    empty,
    wrongStage,
    allFilled: rows.length > 0 && empty.length === 0,
    anyFilled: filled.length > 0,
    noneFound: rows.length === 0,
  };
}

/**
 * @param {string|number} sourceItemId
 * @param {Record<string, unknown> | null | undefined} detail
 * @param {{ skipStageCheck?: boolean }} [opts]
 */
async function evaluateBddPollEligibility(sourceItemId, detail, opts = {}) {
  const flat = flattenItem(detail || {});
  const etId =
    Number.parseInt(String(flat._entityTypeId || flat.entityTypeId || ''), 10) || null;
  const stageId = String(flat.stageId || flat.STAGE_ID || '');
  const atreladoCls = classifyBddQaItemAction(detail || {});
  const atreladoFilled =
    atreladoCls.action === 'skip_filled' || atreladoCls.action === 'skip_qa_history';
  const targets = await discoverBddLinkedTargets(sourceItemId, detail);
  const pushMain = shouldPushBddToMainCard(targets);
  const mode = pushTargetMode();

  // Card atrelado (item da fila) → Novo Teste
  if (pollOnlyNovoTesteEnabled() && !opts.skipStageCheck && etId && stageId) {
    const isNovo = await isNovoTesteStageId(stageId, etId);
    if (!isNovo) {
      const stageLabel = await stageDisplayName(stageId, etId);
      return {
        proceed: false,
        code: 'LINKED_NOT_NOVO_TESTE',
        reason: `card atrelado fora de "Novo Teste" (estágio: ${stageLabel || stageId}) — não grava cenários`,
        stageId,
        stageLabel,
        atreladoFilled,
      };
    }
  }

  // Card pai → Teste de Q.A.
  let parent = null;
  if (parentMustBeTesteQaEnabled() && !opts.skipStageCheck) {
    parent = await resolveParentPrincipalCard(sourceItemId, detail);
    if (!parent) {
      return {
        proceed: false,
        code: 'PARENT_NOT_FOUND',
        reason:
          'card pai não encontrado (URL do feature no UF) — exige pai em "Teste de Q.A."',
        atreladoFilled,
      };
    }

    const parentDetail = parent.detail;
    const parentStageId = parentDetail
      ? String(parentDetail.stageId || parentDetail.STAGE_ID || '')
      : '';
    if (!parentStageId) {
      return {
        proceed: false,
        code: 'PARENT_STAGE_UNKNOWN',
        reason: `não foi possível ler o estágio do card pai ${parent.id} (SPA ${parent.entityTypeId})`,
        parent,
        atreladoFilled,
      };
    }

    await resolveAllStagesDetailed(parent.entityTypeId);

    const parentTesteQa = await isTesteDeQaStageId(parentStageId, parent.entityTypeId);
    if (!parentTesteQa) {
      const parentLabel = await stageDisplayName(parentStageId, parent.entityTypeId);
      return {
        proceed: false,
        code: 'PARENT_NOT_TESTE_QA',
        reason: `card pai ${parent.id} fora de "Teste de Q.A." (estágio: ${parentLabel || parentStageId})`,
        parent: {
          ...parent,
          stageId: parentStageId,
          stageLabel: parentLabel,
        },
        atreladoFilled,
      };
    }
  }

  const linked = await linkedQaFillState(sourceItemId, detail);

  if (atreladoFilled && linked.anyFilled) {
    return {
      proceed: false,
      code: 'MAIN_AND_LINKED_QA_FILLED',
      reason:
        'cenários QA já preenchidos no card atrelado e no(s) destino(s) QA — não altera',
      atreladoFilled: true,
      linked,
      parent,
      mainClassification: atreladoCls,
    };
  }

  if (linkedQaMustBeEmptyEnabled() && linked.anyFilled) {
    const ids = linked.filled.map((r) => `${r.id} (SPA ${r.entityTypeId})`).join(', ');
    return {
      proceed: false,
      code: 'LINKED_QA_ALREADY_FILLED',
      reason: `campo Cenários QA já preenchido no card destino — IDs ${ids}`,
      atreladoFilled,
      linked,
      parent,
      mainClassification: atreladoCls,
    };
  }

  if (atreladoFilled) {
    return {
      proceed: false,
      code: 'LINKED_CARD_QA_ALREADY_FILLED',
      reason: atreladoCls.reason || 'campo Cenários QA já preenchido no card atrelado',
      atreladoFilled: true,
      linked,
      parent,
      mainClassification: atreladoCls,
    };
  }

  if (mode === 'linked' && !pushMain && linked.noneFound) {
    return {
      proceed: true,
      code: 'ELIGIBLE_MAIN_NO_LINKED',
      reason:
        'sem card QA destino — gravará no card atrelado da fila (Novo Teste, campo vazio)',
      atreladoFilled,
      linked,
      parent,
      mainClassification: atreladoCls,
    };
  }

  return {
    proceed: true,
    code: 'ELIGIBLE',
    reason:
      'card atrelado em Novo Teste, pai em Teste de Q.A. e destinos com Cenários QA vazio',
    atreladoFilled,
    linked,
    parent,
    mainClassification: atreladoCls,
  };
}

module.exports = {
  pollOnlyNovoTesteEnabled,
  linkedQaMustBeEmptyEnabled,
  parentMustBeTesteQaEnabled,
  evaluateBddPollEligibility,
  linkedQaFillState,
  resolveParentPrincipalCard,
  mainQaFieldFilled: qaFieldFilled,
};
