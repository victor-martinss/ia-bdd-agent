/**
 * BDD canônico para replicar nos cards QA atrelados (mesma quantidade/conteúdo do pai).
 */
const { flattenItem } = require('../agents/parser');
const { qaBddFieldTextFromFlat } = require('../services/push-bdd-to-crm');
const { cleanGherkinForCrmField } = require('./bdd-crm-merge');
const { parseFeatureEmCenarios } = require('./bdd-scenario-planner');

function contarCenariosGherkin(text) {
  if (!text || typeof text !== 'string') return 0;
  const { cenarios } = parseFeatureEmCenarios(text);
  if (cenarios.length) return cenarios.length;
  const m = text.match(/^\s*cenário\s*:/gim);
  return m ? m.length : 0;
}

function mirrorFromParentEnabled() {
  return process.env.BITRIX_LINKED_BDD_MIRROR_PARENT !== '0';
}

/** Sincroniza card QA atrelado mesmo se já tiver cenários (quando o canônico tem mais). */
function linkedSyncAlwaysEnabled() {
  return process.env.BITRIX_LINKED_BDD_ALWAYS_SYNC !== '0';
}

/**
 * Escolhe o texto BDD a replicar nos atrelados: o que tiver mais cenários (pai × gerado).
 * @param {Record<string, unknown> | null} parentDetail
 * @param {string} generatedBdd
 */
function resolveCanonicalBddForLinked(parentDetail, generatedBdd) {
  const flat = flattenItem(parentDetail || {});
  const { text: parentText } = qaBddFieldTextFromFlat(flat);

  const nGen = contarCenariosGherkin(generatedBdd);
  const nParent = contarCenariosGherkin(parentText);

  let bdd = generatedBdd;
  let source = 'gerado';

  if (mirrorFromParentEnabled() && parentText && nParent > nGen) {
    bdd = parentText;
    source = 'campo_pai';
  } else if (parentText && nParent === nGen && parentText.length > (generatedBdd || '').length) {
    bdd = parentText;
    source = 'campo_pai_mesmo_n';
  }

  if (process.env.BITRIX_BDD_CLEAN_CRM_WRITE !== '0') {
    bdd = cleanGherkinForCrmField(bdd) || bdd;
  }

  return {
    bdd,
    source,
    nGenerated: nGen,
    nParent,
    nCanonical: contarCenariosGherkin(bdd),
  };
}

/**
 * Card atrelado deve receber o BDD canônico (menos cenários que o pai ou sync forçado).
 * @param {string} linkedExistingText
 * @param {string} canonicalBdd
 */
function linkedCardNeedsBddSync(linkedExistingText, canonicalBdd) {
  if (!linkedSyncAlwaysEnabled()) return false;
  const nLinked = contarCenariosGherkin(linkedExistingText);
  const nCanon = contarCenariosGherkin(canonicalBdd);
  if (nCanon <= 0) return false;
  if (nLinked < nCanon) return true;
  if (nLinked === 0 && nCanon > 0) return true;
  const norm = (s) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
  return norm(linkedExistingText) !== norm(canonicalBdd) && nCanon >= nLinked;
}

module.exports = {
  contarCenariosGherkin,
  resolveCanonicalBddForLinked,
  linkedCardNeedsBddSync,
  mirrorFromParentEnabled,
  linkedSyncAlwaysEnabled,
};
