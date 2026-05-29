const { updateCrmItemFields, getTaskDetail } = require('./bitrix.service');
const { isMeaningful, flattenItem } = require('../agents/parser');
const { itemTemHistoricoQa, qaHistoryCheckEnabled } = require('./crm-qa-history');
const {
  defaultAppendMarker,
  mergeFeatureEnabled,
  cleanCrmWriteEnabled,
  cleanGherkinForCrmField,
  fieldHasIaAutomationArtifacts,
  fieldShouldRewriteToCleanBdd,
  crmFieldHasMergeMarker,
  appendOrMergeBddInCrmField,
} = require('../utils/bdd-crm-merge');
const { filterFieldKeysForEntityType } = require('../utils/crm-uf-by-entity');

/**
 * Heurística: chaves UF do item que costumam ser o destino do BDD
 * ("Cenários QA", "Teste Q.A", etc.).
 * @param {string} k
 */
function isDevOnlyBddFieldKey(k) {
  const lower = k.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, '');
  if (compact.includes('testedev') || compact.includes('cenariosdetestedev')) return true;
  if (lower.includes('dev') && lower.includes('cenario') && lower.includes('teste')) {
    return true;
  }
  return false;
}

function matchesBddQaFieldKey(k) {
  const lower = k.toLowerCase();
  if (!(k.startsWith('ufCrm') || k.startsWith('UF_CRM'))) return false;
  if (isDevOnlyBddFieldKey(k)) return false;
  const compact = lower.replace(/[^a-z0-9]/g, '');
  if (compact.includes('testeqa')) return true;
  if (lower.includes('teste') && lower.includes('qa')) return true;
  if (lower.includes('cenario') && lower.includes('qa')) return true;
  return false;
}

/** Prioridade na descoberta: "Teste Q.A" antes de "Cenários QA". */
function bddFieldKeyPriority(k) {
  const lower = k.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]/g, '');
  if (compact.includes('testeqa')) return 0;
  if (lower.includes('teste') && lower.includes('qa')) return 0;
  if (lower.includes('cenario') && lower.includes('qa')) return 1;
  return 2;
}

/**
 * Chaves candidatas no item retornado pelo Bitrix (descoberta automática).
 * @param {Record<string, unknown> | null | undefined} item
 * @returns {string[]}
 */
function discoverQaBddFieldKeys(item) {
  if (!item || typeof item !== 'object') return [];
  const keys = Object.keys(item).filter(matchesBddQaFieldKey);
  const uniq = [...new Set(keys)];
  uniq.sort((a, b) => bddFieldKeyPriority(a) - bddFieldKeyPriority(b));
  return uniq;
}

/** @deprecated use discoverQaBddFieldKeys */
function discoverCenariosQaFieldKeys(item) {
  return discoverQaBddFieldKeys(item);
}

function envFieldList() {
  const raw =
    process.env.BITRIX_UF_BDD_FIELD ||
    process.env.BITRIX_UF_CENARIOS_QA ||
    process.env.BITRIX_UF_TESTE_QA ||
    '';
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Lista de códigos de campo a tentar (env ou descoberta ou padrão).
 * @param {Record<string, unknown> | null | undefined} detail
 */
function fieldKeyCandidates(detail) {
  const flat = flattenItem(detail || {});
  const { key: filledKey } = qaBddFieldTextFromFlat(flat);
  const entityTypeId =
    flat._entityTypeId || flat.entityTypeId || detail?._entityTypeId || detail?.entityTypeId;

  const base = (() => {
    const fromEnv = envFieldList();
    if (fromEnv.length) return [...new Set(fromEnv)];
    const discovered = discoverQaBddFieldKeys(detail);
    if (discovered.length) return discovered;
    return [
      'ufCrm100TesteQa',
      'ufCrm100CenariosQa',
      'ufCrm94TesteQa',
      'ufCrm94CenariosQa',
    ];
  })();

  const scoped = filterFieldKeysForEntityType(base, entityTypeId);

  if (filledKey && scoped.includes(filledKey)) {
    return [filledKey, ...scoped.filter((k) => k !== filledKey)];
  }
  return scoped;
}

function stripHtmlNoiseForBdd(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Valor UF do CRM já usado como armazenamento de cenários BDD? */
function crmUfValueMeaningfulForBdd(raw) {
  if (raw === undefined || raw === null) return false;
  if (Array.isArray(raw)) {
    const joined = raw
      .map((x) => stripHtmlNoiseForBdd(String(x)))
      .filter(Boolean)
      .join('\n');
    return isMeaningful(joined);
  }
  return isMeaningful(stripHtmlNoiseForBdd(String(raw)));
}

/**
 * Chaves a inspecionar para decidir se já existe BDD gravado (não gerar de novo).
 * Usa BITRIX_UF_BDD_FIELD / descoberta; fallback inclui ufCrm94CenariosQa (NGF) e ufCrm100CenariosQa.
 * @param {Record<string, unknown> | null | undefined} detail
 * @returns {string[]}
 */
function fieldKeysForBddPresenceCheck(detail) {
  const flat = flattenItem(detail || {});
  const fromEnv = envFieldList();
  if (fromEnv.length) return [...new Set(fromEnv)];

  const discovered = discoverQaBddFieldKeys(flat);
  if (discovered.length) return discovered;

  return ['ufCrm94CenariosQa', 'ufCrm100CenariosQa'];
}

/**
 * Evita gerar/sobrescrever quando o campo QA já tem conteúdo “protegido” (sem zona de append).
 * Desligar: BITRIX_SKIP_BDD_IF_QA_FILLED=0.
 * @param {Record<string, unknown> | null | undefined} detail
 */
function bddQaStorageFieldAlreadyFilled(detail) {
  return bddQaCrmPushWouldOverwriteWithoutMerge(detail);
}

/**
 * Primeiro campo QA com conteúdo (para log), ou null.
 * @param {Record<string, unknown> | null | undefined} detail
 * @returns {string | null}
 */
function bddQaStorageFirstFilledFieldKey(detail) {
  const flat = flattenItem(detail || {});
  const keys = fieldKeysForBddPresenceCheck(flat);
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(flat, k)) continue;
    if (crmUfValueMeaningfulForBdd(flat[k])) return k;
  }
  return null;
}

/**
 * Primeiro campo QA com texto útil + string normalizada (arrays CRM → \\n).
 * @param {Record<string, unknown>} flat
 * @returns {{ key: string | null, text: string }}
 */
function qaBddFieldTextFromFlat(flat) {
  const keys = fieldKeysForBddPresenceCheck(flat || {});
  for (const k of keys) {
    if (!flat || !Object.prototype.hasOwnProperty.call(flat, k)) continue;
    const raw = flat[k];
    if (!crmUfValueMeaningfulForBdd(raw)) continue;
    if (Array.isArray(raw)) {
      const text = raw.map((x) => String(x).trim()).filter(Boolean).join('\n');
      if (isMeaningful(text)) return { key: k, text: text.trim() };
      continue;
    }
    return { key: k, text: String(raw).trim() };
  }
  return { key: null, text: '' };
}

/**
 * Gravar BDD substituiria conteúdo “protegido” (cenários já aprovados / manuais)?
 * Desligar proteção: BITRIX_SKIP_BDD_IF_QA_FILLED=0.
 * Preservar topo e só atualizar bloco IA: BITRIX_BDD_MERGE_BELOW_MARKER=1 + linha BITRIX_BDD_APPEND_MARKER no campo.
 */
function bddQaCrmPushWouldOverwriteWithoutMerge(detail) {
  if (process.env.BITRIX_SKIP_BDD_IF_QA_FILLED === '0') return false;
  if (mergeFeatureEnabled()) return false;
  return classifyBddQaItemAction(detail).action === 'skip_filled';
}

/**
 * Próxima ação para um item da fila QA (poll / ciclo).
 * @param {Record<string, unknown> | null | undefined} detail
 * @returns {{ action: 'generate'|'merge'|'skip_filled'|'skip_qa_history', fieldKey?: string|null, reason: string }}
 */
function classifyBddQaItemAction(detail) {
  const flat = flattenItem(detail || {});
  const { key, text } = qaBddFieldTextFromFlat(flat);
  const fieldKey = key || bddQaStorageFirstFilledFieldKey(detail);

  if (!text) {
    return {
      action: 'generate',
      fieldKey,
      reason: 'campo de cenários QA vazio — gerar BDD',
    };
  }

  if (process.env.BITRIX_SKIP_BDD_IF_QA_FILLED === '0') {
    return {
      action: 'generate',
      fieldKey,
      reason: 'BITRIX_SKIP_BDD_IF_QA_FILLED=0 — regerar mesmo com campo preenchido',
    };
  }

  if (mergeFeatureEnabled() && !cleanCrmWriteEnabled()) {
    const marker = defaultAppendMarker();
    const hasMarker = crmFieldHasMergeMarker(text, marker);
    if (hasMarker) {
      return {
        action: 'merge',
        fieldKey,
        reason: 'atualizar bloco IA abaixo do marcador (aprovados preservados)',
      };
    }
    if (fieldShouldRewriteToCleanBdd(text)) {
      return {
        action: 'generate',
        fieldKey,
        reason: 'substituir BDD inválido/marcador IA por cenários limpos (sem append)',
      };
    }
    if (process.env.BITRIX_BDD_APPEND_WITHOUT_MARKER === '1') {
      return {
        action: 'merge',
        fieldKey,
        reason: `preservar conteúdo e acrescentar bloco IA (marcador ${marker})`,
      };
    }
    return {
      action: 'skip_filled',
      fieldKey,
      reason: 'cenários QA já preenchidos (merge ativo sem marcador — não injeta append)',
    };
  }

  if (text && fieldShouldRewriteToCleanBdd(text)) {
    return {
      action: 'generate',
      fieldKey,
      reason:
        'reescrever campo com BDD Gherkin válido (E cenário, Então incompleto ou append IA)',
    };
  }

  return {
    action: 'skip_filled',
    fieldKey,
    reason: 'cenários QA já preenchidos — não altera conteúdo aprovado/manual',
  };
}

/**
 * Classificação + checagem de histórico QA (retorno após reprovação).
 * @param {Record<string, unknown> | null | undefined} detail
 */
async function classifyBddQaItemActionAsync(detail) {
  const base = classifyBddQaItemAction(detail);
  if (!qaHistoryCheckEnabled() || base.action !== 'generate') {
    return base;
  }

  const hist = await itemTemHistoricoQa(detail);
  if (hist.has) {
    return {
      action: 'skip_qa_history',
      fieldKey: base.fieldKey,
      reason: hist.reason,
    };
  }
  return base;
}

function bddPodePublicarNoCrm(bdd) {
  if (!bdd || typeof bdd !== 'string') return false;
  const t = bdd.trim();
  if (!t) return false;
  if (/^#\s*Não foi possível gerar BDD/i.test(t)) return false;
  if (/^#\s*Erro ao gerar BDD/i.test(t)) return false;
  return true;
}

function truncarParaCampoUf(texto) {
  const raw = Number.parseInt(
    process.env.BDD_CENARIOS_UF_MAX_CHARS || '60000',
    10
  );
  const max = Number.isFinite(raw) && raw > 100 ? raw : 60000;
  if (texto.length <= max) return texto;
  const sufixo = '\n\n[… truncado para o limite do campo no CRM …]';
  return texto.slice(0, Math.max(0, max - sufixo.length)) + sufixo;
}

/**
 * Grava o BDD no campo do CRM (Teste Q.A., Cenários QA, etc.) — crm.item.update.
 * @param {string|number} taskId
 * @param {string} bdd
 * @param {{ quiet?: boolean, detail?: Record<string, unknown>, entityTypeId?: number }} [options]
 * @returns {Promise<{ ok?: true, skipped?: true, reason?: string, error?: string, field?: string }>}
 */
async function pushBddToCrmCenariosQa(taskId, bdd, options = {}) {
  const { quiet = false, detail, entityTypeId: entityTypeIdOpt } = options;
  const entityTypeId =
    entityTypeIdOpt ??
    (detail && (detail._entityTypeId || detail.entityTypeId)) ??
    undefined;

  if (process.env.BITRIX_PUSH_BDD_TO_UF === '0') {
    return { skipped: true, reason: 'BITRIX_PUSH_BDD_TO_UF=0' };
  }
  if (!bddPodePublicarNoCrm(bdd)) {
    return { skipped: true, reason: 'bdd inválido ou placeholder' };
  }

  let valor = cleanCrmWriteEnabled() ? cleanGherkinForCrmField(bdd) : bdd.trim();
  const flat = flattenItem(detail || {});
  const { text: existingQaText } = qaBddFieldTextFromFlat(flat);
  const marker = defaultAppendMarker();
  const podeMesclarAbaixoMarcador =
    !cleanCrmWriteEnabled() &&
    mergeFeatureEnabled() &&
    existingQaText &&
    crmFieldHasMergeMarker(existingQaText, marker);

  if (podeMesclarAbaixoMarcador) {
    valor = cleanGherkinForCrmField(
      appendOrMergeBddInCrmField(existingQaText, valor, marker) || valor
    );
    if (process.env.DEBUG_BITRIX === '1' && !quiet) {
      console.log(
        `[CRM] item ${taskId} — mesclando BDD abaixo do marcador (aprovados preservados)`
      );
    }
  } else if (
    mergeFeatureEnabled() &&
    existingQaText &&
    process.env.BITRIX_BDD_APPEND_WITHOUT_MARKER === '1'
  ) {
    valor = appendOrMergeBddInCrmField(existingQaText, valor, marker);
    if (process.env.DEBUG_BITRIX === '1' && !quiet) {
      console.log(
        `[CRM] item ${taskId} — append com marcador IA (legado BITRIX_BDD_APPEND_WITHOUT_MARKER=1)`
      );
    }
  } else if (!quiet && existingQaText && fieldShouldRewriteToCleanBdd(existingQaText)) {
    console.log(
      `[CRM] item ${taskId} — substituindo campo por BDD limpo (Gherkin válido, sem append)`
    );
  }

  valor = truncarParaCampoUf(valor);
  const candidates = fieldKeyCandidates(detail);

  if (process.env.DEBUG_BITRIX === '1' && !quiet) {
    console.log(
      `[CRM] item ${taskId} — tentando campo(s) BDD (Teste Q.A. / Cenários QA):`,
      candidates.join(', ')
    );
  }

  let lastError = '';
  for (const field of candidates) {
    try {
      await updateCrmItemFields(taskId, { [field]: valor }, { entityTypeId });

      if (process.env.BITRIX_VERIFY_CRM_WRITE !== '0') {
        try {
          const refreshed = await getTaskDetail(taskId, { entityTypeId });
          const flat = flattenItem(refreshed);
          const gravado = flat[field];
          if (!crmUfValueMeaningfulForBdd(gravado)) {
            lastError = `campo ${field} permaneceu vazio após crm.item.update`;
            if (!quiet) {
              console.warn(
                `  ↳ ${lastError} (entityTypeId=${entityTypeId || '?'})`
              );
            }
            continue;
          }
        } catch (verifyErr) {
          if (process.env.DEBUG_BITRIX === '1' && !quiet) {
            console.warn(
              `  ↳ verificação pós-gravação ignorada: ${verifyErr.message || verifyErr}`
            );
          }
        }
      }

      if (!quiet) {
        console.log(`📝 CRM atualizado: ${field} (item ${taskId})`);
      }
      return { ok: true, field };
    } catch (e) {
      lastError = e.message || String(e);
      if (!quiet && candidates.length > 1) {
        console.warn(`  ↳ campo "${field}" falhou: ${lastError}`);
      }
    }
  }

  if (!quiet) {
    console.error(
      `Falha ao gravar BDD no CRM (item ${taskId}; tentados: ${candidates.join(', ')}):`,
      lastError
    );
  }
  return { ok: false, error: lastError };
}

module.exports = {
  pushBddToCrmCenariosQa,
  bddPodePublicarNoCrm,
  truncarParaCampoUf,
  discoverQaBddFieldKeys,
  discoverCenariosQaFieldKeys,
  fieldKeyCandidates,
  bddQaStorageFieldAlreadyFilled,
  bddQaCrmPushWouldOverwriteWithoutMerge,
  classifyBddQaItemAction,
  classifyBddQaItemActionAsync,
  qaBddFieldTextFromFlat,
  bddQaStorageFirstFilledFieldKey,
  fieldKeysForBddPresenceCheck,
  crmUfValueMeaningfulForBdd,
};
