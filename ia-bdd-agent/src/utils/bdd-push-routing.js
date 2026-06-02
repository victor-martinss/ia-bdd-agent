/**
 * Define onde gravar BDD: card principal vs tarefas/cards atrelados.
 */
const { flattenItem } = require('../agents/parser');
const { parentIdFromItem, listChildCrmItemIds } = require('../services/crm-item-links');
const { entityTypeIdCandidatesForItem } = require('../services/bitrix.service');
const { listLinkedQaCrmItemIds } = require('../services/push-bdd-to-qa-linked-crm');
const {
  listLinkedTaskIdsForCrmItem,
} = require('../services/push-bdd-to-linked-tasks');

function pushTargetMode() {
  const m = (process.env.BITRIX_BDD_PUSH_TARGET || 'linked').trim().toLowerCase();
  if (['main', 'linked', 'both'].includes(m)) return m;
  return 'linked';
}

/**
 * @param {Record<string, unknown>} flat
 * @param {number} entityTypeId
 */
function isChildCrmItem(flat, entityTypeId) {
  if (!flat || !entityTypeId) return false;
  const pid = parentIdFromItem(flat, entityTypeId);
  return pid != null && Number(pid) > 0;
}

/**
 * @param {string|number} crmItemId
 * @param {Record<string, unknown> | null} [detail]
 */
async function discoverBddLinkedTargets(crmItemId, detail = null) {
  const flat = flattenItem(detail || {});
  const etId =
    Number.parseInt(String(flat._entityTypeId || flat.entityTypeId || ''), 10) ||
    null;

  let childCrmIds = [];
  let linkedQaCrm = [];
  let linkedBitrixTaskIds = [];

  if (process.env.BITRIX_PUSH_BDD_TO_LINKED_CRM_ITEMS !== '0') {
    try {
      const childSet = new Set();
      for (const candidateEt of entityTypeIdCandidatesForItem(detail || {})) {
        for (const id of await listChildCrmItemIds(crmItemId, candidateEt)) {
          childSet.add(id);
        }
      }
      childCrmIds = [...childSet];
    } catch {
      childCrmIds = [];
    }
  }

  if (process.env.BITRIX_PUSH_BDD_TO_QA_LINKED_CRM !== '0') {
    try {
      linkedQaCrm = await listLinkedQaCrmItemIds(crmItemId, detail);
    } catch {
      linkedQaCrm = [];
    }
  }

  if (process.env.BITRIX_PUSH_BDD_TO_LINKED_TASKS !== '0') {
    try {
      linkedBitrixTaskIds = await listLinkedTaskIdsForCrmItem(crmItemId, detail);
    } catch {
      linkedBitrixTaskIds = [];
    }
  }

  const childSet = new Set(childCrmIds.map(Number));
  const qaIds = linkedQaCrm
    .map((r) => Number(r.id))
    .filter((id) => Number.isFinite(id) && id !== Number(crmItemId) && !childSet.has(id));

  const isChild = etId ? isChildCrmItem(flat, etId) : false;
  const hasLinkedDestinations =
    childCrmIds.length > 0 || qaIds.length > 0 || linkedBitrixTaskIds.length > 0;

  return {
    entityTypeId: etId,
    isChildQaCard: isChild,
    childCrmIds,
    linkedQaCrmIds: qaIds,
    linkedQaCrm,
    linkedBitrixTaskIds,
    hasLinkedDestinations,
  };
}

/**
 * Gravar no card que originou o processamento (crm.item.update no id da fila)?
 * @param {{ isChildQaCard: boolean, hasLinkedDestinations: boolean }} targets
 */
function shouldPushBddToMainCard(targets) {
  if (!targets) return true;
  if (targets.isChildQaCard) return true;

  const mode = pushTargetMode();
  if (mode === 'main') return true;
  if (mode === 'both') return true;

  if (process.env.BITRIX_SKIP_BDD_ON_MAIN_WHEN_LINKED === '0') return true;

  if (mode === 'linked' && targets.hasLinkedDestinations) return false;
  return true;
}

/**
 * Grava BDD em cards QA vinculados, filhos CRM e tarefas Bitrix atreladas.
 * @param {string|number} crmItemId
 * @param {string} bdd
 * @param {Record<string, unknown> | null} [detail]
 * @param {{ quiet?: boolean }} [options]
 */
async function pushBddToAllLinkedDestinations(crmItemId, bdd, detail = null, options = {}) {
  const { pushBddToLinkedBitrixTasks, pushBddToLinkedCrmChildItems } = require('../services/push-bdd-to-linked-tasks');
  const { pushBddToQaLinkedCrmItems } = require('../services/push-bdd-to-qa-linked-crm');
  const quiet = options.quiet !== false;

  const qa = await pushBddToQaLinkedCrmItems(crmItemId, bdd, { quiet, detail });
  const child = await pushBddToLinkedCrmChildItems(crmItemId, bdd, { quiet, detail });
  const tasks = await pushBddToLinkedBitrixTasks(crmItemId, bdd, { quiet, detail });

  const updated =
    (qa.updated || 0) + (child.updated || 0) + (tasks.updated || 0);
  const failed = (qa.failed || 0) + (child.failed || 0) + (tasks.failed || 0);

  return { qa, child, tasks, updated, failed };
}

module.exports = {
  pushTargetMode,
  discoverBddLinkedTargets,
  shouldPushBddToMainCard,
  isChildCrmItem,
  pushBddToAllLinkedDestinations,
};
