/**
 * BDD canônico para replicar nos cards QA atrelados (mesma quantidade/conteúdo do pai).
 */
const { flattenItem } = require('../agents/parser');
const { qaBddFieldTextFromFlat } = require('../services/push-bdd-to-crm');
const { cleanGherkinForCrmField } = require('./bdd-crm-merge');
const { parseFeatureEmCenarios } = require('./bdd-scenario-planner');
const {
  numerarCenariosNaFeature,
  featurePrecisaNumeracao,
} = require('./bdd-scenario-numbering');
const { isLinhaCenario } = require('./bdd-scenario-numbering');

function contarCenariosGherkin(text) {
  if (!text || typeof text !== 'string') return 0;
  const { cenarios } = parseFeatureEmCenarios(text);
  if (cenarios.length) return cenarios.length;
  const linhas = text.split(/\r?\n/).filter((l) => isLinhaCenario(l.trim()));
  return linhas.length;
}

function mirrorFromParentEnabled() {
  return process.env.BITRIX_LINKED_BDD_MIRROR_PARENT !== '0';
}

/** Sincroniza card QA atrelado mesmo se já tiver cenários (quando o canônico tem mais). */
function linkedSyncAlwaysEnabled() {
  return process.env.BITRIX_LINKED_BDD_ALWAYS_SYNC !== '0';
}

/** Pai com múltiplos Então ou ambiente quebrado — preferir BDD gerado agora. */
function parentBddTemDefeitosEstruturais(text) {
  if (!text || typeof text !== 'string') return false;
  const { cenarios } = parseFeatureEmCenarios(text);
  for (const c of cenarios) {
    const corpo = (c.linhas || []).join('\n');
    const entoes = corpo.split(/\r?\n/).filter((l) => /^\s*ent[aã]o\s+/i.test(l.trim()));
    if (entoes.length > 1) return true;
    if (/\[MobilePACS|\[MobileRouter/i.test(corpo)) return true;
    if (/\[b\]|\[\/b\]/i.test(corpo)) return true;
    if (/…/.test(corpo)) return true;
    if (/lacuna\s*—|defeito observado/i.test(c.titulo || corpo)) return true;
    for (const ent of entoes) {
      const corpoEnt = ent.replace(/^\s*ent[aã]o\s+/i, '');
      if (corpoEnt.length > 220 || /…/.test(corpoEnt)) return true;
    }
  }
  return false;
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

  const paiDefeituoso = parentBddTemDefeitosEstruturais(parentText);
  if (
    mirrorFromParentEnabled() &&
    parentText &&
    nParent > nGen &&
    !paiDefeituoso &&
    process.env.BDD_PREFER_GENERATED_CANONICAL !== '1'
  ) {
    bdd = parentText;
    source = 'campo_pai';
  } else if (
    parentText &&
    nParent === nGen &&
    parentText.length > (generatedBdd || '').length &&
    !paiDefeituoso
  ) {
    bdd = parentText;
    source = 'campo_pai_mesmo_n';
  }

  if (process.env.BITRIX_BDD_CLEAN_CRM_WRITE !== '0') {
    bdd = cleanGherkinForCrmField(bdd) || bdd;
  }

  bdd = numerarCenariosNaFeature(bdd);

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
  if (featurePrecisaNumeracao(linkedExistingText)) return true;
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
