/**
 * Regras de elegibilidade do poll: gravar BDD somente em Novo Teste
 * com campo Cenários QA vazio no card atrelado (e não sobrescrever se ambos preenchidos).
 */
const { flattenItem } = require('../agents/parser');
const {
  classifyBddQaItemAction,
  qaBddFieldTextFromFlat,
} = require('../services/push-bdd-to-crm');
const { listLinkedQaCrmItemIds } = require('../services/push-bdd-to-qa-linked-crm');
const {
  isNovoTesteStageId,
  stageDisplayName,
} = require('../services/crm-qa-stages');
const { discoverBddLinkedTargets, shouldPushBddToMainCard, pushTargetMode } = require('./bdd-push-routing');
const {
  pollOnlyNovoTesteEnabled,
  linkedQaMustBeEmptyEnabled,
} = require('./bdd-poll-rules');

/**
 * @param {Record<string, unknown>} flat
 */
function mainQaFieldFilled(flat) {
  const cls = classifyBddQaItemAction({ ...(flat || {}) });
  return cls.action === 'skip_filled' || cls.action === 'skip_qa_history';
}

/**
 * @param {Record<string, unknown> | null | undefined} detail
 * @returns {Promise<{ filled: boolean, items: { id: number, entityTypeId: number, fieldKey?: string|null, title?: string }[] }>}
 */
async function linkedQaFillState(sourceItemId, detail) {
  const rows = await listLinkedQaCrmItemIds(sourceItemId, detail);
  const filled = [];
  const empty = [];

  for (const row of rows) {
    const { getTaskDetail } = require('../services/bitrix.service');
    let childDetail = null;
    try {
      childDetail = await getTaskDetail(row.id, { entityTypeId: row.entityTypeId });
    } catch {
      empty.push(row);
      continue;
    }
    const flat = flattenItem(childDetail || {});
    const { key, text } = qaBddFieldTextFromFlat(flat);
    const cls = classifyBddQaItemAction(childDetail || {});
    const isFilled =
      !!text &&
      (cls.action === 'skip_filled' || cls.action === 'skip_qa_history');
    const entry = {
      id: row.id,
      entityTypeId: row.entityTypeId,
      fieldKey: key,
      title: row.title || childDetail?.title || childDetail?.TITLE,
    };
    if (isFilled) filled.push(entry);
    else empty.push(entry);
  }

  return {
    linkedRows: rows,
    filled,
    empty,
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
  const mainCls = classifyBddQaItemAction(detail || {});
  const mainFilled = mainCls.action === 'skip_filled' || mainCls.action === 'skip_qa_history';
  const targets = await discoverBddLinkedTargets(sourceItemId, detail);
  const pushMain = shouldPushBddToMainCard(targets);
  const mode = pushTargetMode();

  if (pollOnlyNovoTesteEnabled() && !opts.skipStageCheck && etId && stageId) {
    const isNovo = await isNovoTesteStageId(stageId, etId);
    if (!isNovo) {
      const stageLabel = await stageDisplayName(stageId, etId);
      return {
        proceed: false,
        code: 'STAGE_NOT_NOVO_TESTE',
        reason: `card fora de "Novo Teste" (estágio atual: ${stageLabel || stageId}) — não grava cenários`,
        stageId,
        stageLabel,
        mainFilled,
      };
    }
  }

  const linked = await linkedQaFillState(sourceItemId, detail);

  if (mainFilled && linked.anyFilled) {
    return {
      proceed: false,
      code: 'MAIN_AND_LINKED_QA_FILLED',
      reason:
        'cenários QA já preenchidos no card principal e no(s) card(s) atrelado(s) — não altera',
      mainFilled: true,
      linked,
      mainClassification: mainCls,
    };
  }

  if (linkedQaMustBeEmptyEnabled() && linked.anyFilled) {
    const ids = linked.filled.map((r) => `${r.id} (SPA ${r.entityTypeId})`).join(', ');
    return {
      proceed: false,
      code: 'LINKED_QA_ALREADY_FILLED',
      reason: `campo Cenários QA já preenchido no card atrelado — IDs ${ids}`,
      mainFilled,
      linked,
      mainClassification: mainCls,
    };
  }

  if (mode === 'linked' && !pushMain && linked.noneFound) {
    if (!mainFilled) {
      return {
        proceed: true,
        code: 'ELIGIBLE_MAIN_NO_LINKED',
        reason:
          'sem card QA atrelado — gravará no campo Cenários QA do card principal (Novo Teste)',
        mainFilled,
        linked,
        mainClassification: mainCls,
      };
    }
    return {
      proceed: false,
      code: 'NO_LINKED_QA_CARD',
      reason:
        'BITRIX_BDD_PUSH_TARGET=linked — nenhum card QA atrelado e card principal já preenchido',
      mainFilled,
      linked,
      mainClassification: mainCls,
    };
  }

  if (mainFilled && (mode === 'main' || pushMain)) {
    return {
      proceed: false,
      code: 'MAIN_QA_ALREADY_FILLED',
      reason: mainCls.reason || 'cenários QA já preenchidos no card principal',
      mainFilled: true,
      linked,
      mainClassification: mainCls,
    };
  }

  return {
    proceed: true,
    code: 'ELIGIBLE',
    reason: 'Novo Teste com destino QA vazio — elegível para gravar',
    mainFilled,
    linked,
    mainClassification: mainCls,
  };
}

module.exports = {
  pollOnlyNovoTesteEnabled,
  linkedQaMustBeEmptyEnabled,
  evaluateBddPollEligibility,
  linkedQaFillState,
  mainQaFieldFilled,
};
