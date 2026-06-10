/**
 * Diagnóstico da causa raiz quando um card na fila não recebe cenários QA.
 */
const { flattenItem } = require('../agents/parser');
const { bddPodePublicarNoCrm } = require('../services/push-bdd-to-crm');
const { ctxTemCamposEstruturados } = require('./bdd-gherkin');
const { limparTexto } = require('./bdd-gherkin');

/**
 * @param {object} params
 * @returns {{ code: string, reason: string, hints?: string[] }}
 */
function diagnoseBddSkipRootCause(params = {}) {
  const {
    detail,
    bdd,
    error,
    classification,
    eligibility,
    crmResult,
    linkedQaResult,
    publicavel,
    generated = false,
  } = params;

  if (error) {
    return {
      code: 'GENERATION_EXCEPTION',
      reason: `erro ao gerar BDD: ${error}`,
      hints: ['reinicie o poll após deploy', 'tente npm run bdd:item -- <id> <spa>'],
    };
  }

  if (eligibility && eligibility.proceed === false) {
    return {
      code: eligibility.code || 'NOT_ELIGIBLE',
      reason: eligibility.reason || 'card não elegível para gravação',
      hints: hintsForEligibilityCode(eligibility.code),
    };
  }

  if (classification) {
    if (classification.action === 'skip_filled') {
      return {
        code: 'MAIN_QA_ALREADY_FILLED',
        reason: classification.reason || 'campo Cenários QA do card principal já preenchido',
      };
    }
    if (classification.action === 'skip_qa_history') {
      return {
        code: 'QA_HISTORY_RETURN',
        reason: classification.reason || 'card retornou após ciclo de QA — não regera cenários',
      };
    }
  }

  if (generated && publicavel === false) {
    const ctxHints = diagnoseEmptyContext(detail);
    return {
      code: 'BDD_NOT_PUBLISHABLE',
      reason:
        'BDD gerado sem cenários Gherkin válidos (faltam Dev, NGF, evidências ou título parseável)',
      hints: ctxHints,
    };
  }

  if (bdd && !bddPodePublicarNoCrm(bdd)) {
    return {
      code: 'BDD_NOT_PUBLISHABLE',
      reason: 'texto BDD vazio ou placeholder — sem cenários para publicar no CRM',
      hints: diagnoseEmptyContext(detail),
    };
  }

  if (linkedQaResult?.skippedAlreadyFilled > 0 && !linkedQaResult?.updated) {
    return {
      code: 'LINKED_QA_ALREADY_FILLED',
      reason: `${linkedQaResult.skippedAlreadyFilled} card(s) QA atrelado(s) já com cenários preenchidos`,
    };
  }

  if (linkedQaResult?.reason === 'nenhum card QA vinculado na fila') {
    return {
      code: 'NO_LINKED_QA_CARD',
      reason: 'nenhum card QA atrelado na fila para receber os cenários',
      hints: [
        'confira vínculo por ID externo / URL do card pai no Bitrix',
        'BITRIX_BDD_PUSH_TARGET=linked exige card QA 1276/1294 vinculado',
      ],
    };
  }

  if (crmResult?.failed > 0) {
    return {
      code: 'CRM_WRITE_FAILED',
      reason: 'falha ao gravar no CRM (API Bitrix ou campo UF incorreto)',
      hints: ['verifique BITRIX_UF_BDD_FIELD e entityTypeId do card'],
    };
  }

  if (publicavel && crmResult?.skipped > 0 && !crmResult?.ok && !linkedQaResult?.updated) {
    return {
      code: 'CRM_WRITE_SKIPPED',
      reason: 'BDD válido mas gravação ignorada (estágio, destino ou regra de proteção)',
    };
  }

  return {
    code: 'UNKNOWN',
    reason: 'cenários não gravados — motivo não classificado automaticamente',
  };
}

function hintsForEligibilityCode(code) {
  switch (code) {
    case 'STAGE_NOT_NOVO_TESTE':
      return ['mova o card para a coluna "Novo Teste" para gerar cenários'];
    case 'LINKED_QA_ALREADY_FILLED':
      return ['limpe o campo Cenários QA no card atrelado se quiser regerar'];
    case 'MAIN_AND_LINKED_QA_FILLED':
      return ['card principal e atrelado já têm cenários — nenhuma alteração'];
    case 'NO_LINKED_QA_CARD':
      return ['vincule um card QA (SPA 1276) ao card de origem'];
    default:
      return [];
  }
}

function diagnoseEmptyContext(detail) {
  const flat = flattenItem(detail || {});
  const hints = [];
  const dev = limparTexto(flat.ufCrm100CenariosDeTesteDev || flat.ufCrm94CenariosDeTesteDev || '');
  const desc = limparTexto(flat.ufCrm100NgfDescricaoDoOcorrido || flat.ufCrm94NgfDescricaoDoOcorrido || flat.description || '');
  const passos = limparTexto(flat.ufCrm100NgfPassosParaReproduzir || flat.ufCrm94NgfPassosParaReproduzir || '');
  const titulo = limparTexto(flat.title || flat.TITLE || '');

  if (!dev) hints.push('preencha "Cenários de Teste (Dev)" no card ou no card pai vinculado');
  if (!desc && !passos) hints.push('preencha descrição/passos NGF no chamado');
  if (!titulo) hints.push('título do card ausente');

  try {
    const ctx = {
      titulo,
      descricao: desc,
      passos,
      cenariosTesteDev: dev,
      resultadoEsperado: flat.ufCrm100NgfResultadoEsperado || flat.ufCrm94NgfResultadoEsperado || '',
      resultadoObtido: flat.ufCrm100NgfResultadoObtido || flat.ufCrm94NgfResultadoObtido || '',
    };
    if (!ctxTemCamposEstruturados(ctx) && !dev) {
      hints.push('card só com título — inclua blocos Dev ou campos NGF para cenários assertivos');
    }
  } catch {
    /* ignore */
  }

  return hints.length ? hints : undefined;
}

/**
 * @param {string|number} itemId
 * @param {{ code: string, reason: string, hints?: string[] }} diagnosis
 */
function logBddSkipRootCause(itemId, diagnosis, { isNewInQueue = false } = {}) {
  const prefix = isNewInQueue ? '🆕 CAUSA RAIZ (novo na fila)' : '⚠ CAUSA RAIZ';
  console.log(`${prefix} — item ${itemId}: [${diagnosis.code}] ${diagnosis.reason}`);
  if (diagnosis.hints?.length) {
    for (const h of diagnosis.hints) {
      console.log(`     → ${h}`);
    }
  }
}

module.exports = {
  diagnoseBddSkipRootCause,
  logBddSkipRootCause,
  diagnoseEmptyContext,
};
