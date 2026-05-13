const { updateCrmItemFields } = require('./bitrix.service');

/**
 * Heurística: chaves UF do item que costumam ser o destino do BDD
 * ("Cenários QA", "Teste Q.A", etc.).
 * @param {string} k
 */
function matchesBddQaFieldKey(k) {
  const lower = k.toLowerCase();
  if (!(k.startsWith('ufCrm') || k.startsWith('UF_CRM'))) return false;
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
  const fromEnv = envFieldList();
  if (fromEnv.length) return [...new Set(fromEnv)];

  const discovered = discoverQaBddFieldKeys(detail);
  if (discovered.length) return discovered;

  return ['ufCrm94TesteQa', 'ufCrm94CenariosQa'];
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
 * @param {{ quiet?: boolean, detail?: Record<string, unknown> }} [options]
 * @returns {Promise<{ ok?: true, skipped?: true, reason?: string, error?: string, field?: string }>}
 */
async function pushBddToCrmCenariosQa(taskId, bdd, options = {}) {
  const { quiet = false, detail } = options;

  if (process.env.BITRIX_PUSH_BDD_TO_UF === '0') {
    return { skipped: true, reason: 'BITRIX_PUSH_BDD_TO_UF=0' };
  }
  if (!bddPodePublicarNoCrm(bdd)) {
    return { skipped: true, reason: 'bdd inválido ou placeholder' };
  }

  const valor = truncarParaCampoUf(bdd.trim());
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
      await updateCrmItemFields(taskId, { [field]: valor });
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
};
