require('../../load-env');
const axios = require('axios');
const { flattenItem, isMeaningful } = require('../agents/parser');
const { pickCrmUfText } = require('../utils/crm-field-resolver');
const {
  resolveQaStagesDetailed,
  fetchCategories,
  fetchStatusesForCategory,
  qaStageNameNeedles,
} = require('./crm-qa-stages');

const BASE_URL = process.env.BITRIX_WEBHOOK;

/** @type {Map<string, object[]>} */
const stageHistoryCache = new Map();

/** @type {Map<number, { stageId: string, stageName: string }[]>} */
const allStagesCache = new Map();

function qaHistoryCheckEnabled() {
  return process.env.BITRIX_SKIP_BDD_IF_QA_HISTORY !== '0';
}

function parseNameList(envVar, fallback) {
  const raw = (process.env[envVar] || fallback || '')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.length ? raw : [];
}

function stageNameMatchesNeedles(stageName, needles) {
  const name = String(stageName || '').trim().toLowerCase();
  if (!name) return false;
  return needles.some((n) => {
    const needle = String(n).trim().toLowerCase();
    if (!needle) return false;
    return name === needle || name.includes(needle);
  });
}

function novoTesteNeedles() {
  const fromStage = parseNameList('BITRIX_STAGE_NAME', 'Novo Teste');
  const fromQa = qaStageNameNeedles().filter((n) =>
    /novo\s*teste/i.test(String(n))
  );
  return [...new Set([...fromStage, ...fromQa, 'Novo Teste'])];
}

function qaReturnStageNeedles() {
  const fromEnv = parseNameList('BITRIX_QA_RETURN_STAGE_NAMES', '');
  if (fromEnv.length) return fromEnv;
  return [
    'reprov',
    'retorn',
    'devolv',
    'correção',
    'correcao',
    'falhou',
    'não conforme',
    'nao conforme',
    'em desenvolvimento',
  ];
}

function looksLikeNovoTesteStage(stageName) {
  return stageNameMatchesNeedles(stageName, novoTesteNeedles());
}

function looksLikeQaReturnStage(stageName) {
  return stageNameMatchesNeedles(stageName, qaReturnStageNeedles());
}

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
 * @param {number} entityTypeIdNum
 * @returns {Promise<{ stageId: string, stageName: string }[]>}
 */
async function resolveAllStageCatalog(entityTypeIdNum) {
  if (allStagesCache.has(entityTypeIdNum)) {
    return allStagesCache.get(entityTypeIdNum);
  }
  const rows = [];
  const categories = await fetchCategories(entityTypeIdNum);
  const catIds = categories.length
    ? categories.map((c) => Number(c.id ?? c.ID)).filter(Number.isFinite)
    : [0];

  for (const catId of catIds) {
    const statuses = await fetchStatusesForCategory(entityTypeIdNum, catId);
    for (const st of statuses) {
      const sid = st.STATUS_ID || st.statusId;
      if (!sid) continue;
      rows.push({
        stageId: String(sid),
        stageName: String(st.NAME || st.name || '').trim(),
      });
    }
  }

  allStagesCache.set(entityTypeIdNum, rows);
  return rows;
}

/**
 * @param {number} entityTypeIdNum
 */
async function resolveNovoTesteStageIds(entityTypeIdNum) {
  const catalog = await resolveAllStageCatalog(entityTypeIdNum);
  return catalog
    .filter((r) => looksLikeNovoTesteStage(r.stageName))
    .map((r) => r.stageId);
}

/**
 * Colunas QA já percorridas (exceto Novo Teste) — ex.: Teste de Q.A.
 * @param {number} entityTypeIdNum
 */
async function resolveQaProgressStageIds(entityTypeIdNum) {
  const detailed = await resolveQaStagesDetailed(entityTypeIdNum);
  const progress = detailed
    .filter((r) => !looksLikeNovoTesteStage(r.stageName))
    .map((r) => r.stageId);
  const catalog = await resolveAllStageCatalog(entityTypeIdNum);
  for (const r of catalog) {
    if (looksLikeQaReturnStage(r.stageName)) progress.push(r.stageId);
  }
  return [...new Set(progress)];
}

/**
 * @param {number} entityTypeIdNum
 * @param {string|number} itemId
 * @returns {Promise<object[]>}
 */
async function fetchItemStageHistory(entityTypeIdNum, itemId) {
  const cacheKey = `${entityTypeIdNum}:${itemId}`;
  if (stageHistoryCache.has(cacheKey)) {
    return stageHistoryCache.get(cacheKey);
  }

  if (!BASE_URL) return [];

  const url = `${BASE_URL}/crm.stagehistory.list`;
  const all = [];
  let start = 0;

  try {
    for (let page = 0; page < 20; page++) {
      const response = await axios.post(
        url,
        {
          entityTypeId: entityTypeIdNum,
          order: { ID: 'ASC' },
          filter: { OWNER_ID: Number.parseInt(String(itemId), 10) },
          select: ['ID', 'STAGE_ID', 'CREATED_TIME'],
          start,
        },
        {
          headers: { 'Content-Type': 'application/json' },
          validateStatus: (s) => s >= 200 && s < 500,
          timeout: Number.parseInt(process.env.BITRIX_STAGE_HISTORY_TIMEOUT_MS || '15000', 10) || 15000,
        }
      );

      const msg = restErrorMessage(response.data);
      if (response.status >= 400 || msg) {
        if (process.env.DEBUG_BITRIX === '1') {
          console.warn(
            `[QA histórico] crm.stagehistory.list item ${itemId}: ${msg || response.status}`
          );
        }
        break;
      }

      const batch = response.data?.result;
      if (Array.isArray(batch) && batch.length) {
        all.push(...batch);
      }

      if (!response.data?.next) break;
      start = Number(response.data.next) || start + (batch?.length || 0);
      if (!batch?.length) break;
    }
  } catch (e) {
    if (process.env.DEBUG_BITRIX === '1') {
      console.warn(`[QA histórico] item ${itemId}:`, e.message || e);
    }
  }

  stageHistoryCache.set(cacheKey, all);
  return all;
}

/**
 * Sinais no card de que já passou por triagem/ciclo QA (sem API de histórico).
 * @param {Record<string, unknown>} flat
 */
function qaHistorySignalsFromFields(flat) {
  const triagem = pickCrmUfText(flat, [
    'NgfObservacoesDaTriagemDeQualidade',
    'ObservacoesDaTriagem',
  ]);
  if (isMeaningful(triagem)) {
    return {
      has: true,
      reason: 'observações de triagem QA preenchidas no card',
    };
  }

  for (const k of Object.keys(flat || {})) {
    if (!/^ufCrm\d+/i.test(k)) continue;
    const lower = k.toLowerCase();
    if (
      (lower.includes('reprov') ||
        lower.includes('retorno') ||
        lower.includes('historico') ||
        lower.includes('histórico')) &&
      (lower.includes('qa') || lower.includes('qualidade') || lower.includes('teste'))
    ) {
      const v = flat[k];
      if (isMeaningful(v)) {
        return {
          has: true,
          reason: `campo ${k} indica ciclo QA anterior`,
        };
      }
    }
  }

  return { has: false, reason: '' };
}

/**
 * Card já passou por QA e voltou (reprovado/retorno) — não gerar cenários de novo.
 * @param {Record<string, unknown> | null | undefined} detail
 * @returns {Promise<{ has: boolean, reason: string }>}
 */
async function itemTemHistoricoQa(detail) {
  if (!qaHistoryCheckEnabled()) {
    return { has: false, reason: '' };
  }

  const flat = flattenItem(detail || {});
  const fromFields = qaHistorySignalsFromFields(flat);
  if (fromFields.has) return fromFields;

  const itemId = flat.id ?? flat.ID;
  const entityTypeId =
    flat._entityTypeId ??
    flat.entityTypeId ??
    Number.parseInt(process.env.BITRIX_ENTITY_TYPE_ID || '1276', 10);

  if (!itemId || !Number.isFinite(Number(entityTypeId))) {
    return { has: false, reason: '' };
  }

  const etId = Number(entityTypeId);
  const history = await fetchItemStageHistory(etId, itemId);
  if (!history.length) {
    return { has: false, reason: '' };
  }

  const catalog = await resolveAllStageCatalog(etId);
  const nameById = new Map(catalog.map((r) => [r.stageId, r.stageName]));

  const novoIds = new Set(await resolveNovoTesteStageIds(etId));
  const progressIds = new Set(await resolveQaProgressStageIds(etId));

  let novoVisits = 0;
  let sawQaProgress = false;
  let sawReturnStage = false;

  for (const entry of history) {
    const sid = String(entry.STAGE_ID || entry.stageId || '');
    const stageName = nameById.get(sid) || '';

    if (novoIds.has(sid)) novoVisits += 1;
    if (progressIds.has(sid)) sawQaProgress = true;
    if (looksLikeQaReturnStage(stageName)) sawReturnStage = true;
  }

  if (sawQaProgress) {
    return {
      has: true,
      reason:
        'histórico do card: já esteve em coluna de teste QA (ex.: Teste de Q.A.) — retorno após reprovação',
    };
  }

  if (sawReturnStage) {
    return {
      has: true,
      reason:
        'histórico do card: passou por coluna de retorno/reprovação antes de voltar a Novo Teste',
    };
  }

  if (novoVisits > 1) {
    return {
      has: true,
      reason:
        'histórico do card: retornou à coluna Novo Teste após ciclo anterior de QA',
    };
  }

  return { has: false, reason: '' };
}

/**
 * Resumo para ordenação de cenários BDD (risco/regressão).
 * @param {Record<string, unknown> | null | undefined} detail
 */
async function resumoHistoricoParaBdd(detail) {
  const hist = await itemTemHistoricoQa(detail);
  const flat = flattenItem(detail || {});
  const triagem = pickCrmUfText(flat, [
    'NgfObservacoesDaTriagemDeQualidade',
    'ObservacoesDaTriagem',
  ]);
  const triagemTxt = String(triagem || '').toLowerCase();
  const regressaoExplicita =
    /\b(reprov|retorn|regress|revalid|homolog|j[aá]\s+test)/i.test(triagemTxt);

  return {
    isRetornoQa: hist.has || regressaoExplicita,
    reason: hist.reason || (regressaoExplicita ? 'observações de triagem indicam reteste' : ''),
    prioridadeRegressao: hist.has || regressaoExplicita,
    observacoesTriagem: isMeaningful(triagem) ? String(triagem).trim() : '',
  };
}

function clearQaHistoryCache() {
  stageHistoryCache.clear();
}

module.exports = {
  qaHistoryCheckEnabled,
  itemTemHistoricoQa,
  qaHistorySignalsFromFields,
  resumoHistoricoParaBdd,
  fetchItemStageHistory,
  clearQaHistoryCache,
};
