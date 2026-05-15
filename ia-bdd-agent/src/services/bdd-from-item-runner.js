const path = require('path');
const {
  getTaskDetail,
  setRuntimeEntityTypeIdOverride,
  clearRuntimeEntityTypeIdOverride,
} = require('./bitrix.service');
const { runBitrixBddCycle } = require('../orchestrator/run-bitrix-bdd-cycle');

/**
 * Gera BDD e grava no CRM + atrelamentos para um único item (mesmo fluxo do run-bdd-item.js).
 *
 * @param {string} packageRoot - raiz ia-bdd-agent (__dirname pacote)
 * @param {{ itemId: number, entityTypeId?: number|null, quiet?: boolean }} opts
 */
async function runBddForSingleCrmItem(packageRoot, opts) {
  const { itemId, entityTypeId = null, quiet = false } = opts;

  const numId =
    typeof itemId === 'number' && Number.isFinite(itemId)
      ? Math.trunc(itemId)
      : Number.parseInt(String(itemId || '').trim(), 10);
  if (!Number.isFinite(numId) || numId <= 0) {
    throw new Error(`ID de item CRM inválido: ${itemId}`);
  }

  const pkg = packageRoot || path.join(__dirname, '../..');

  if (entityTypeId != null) {
    const et = Number.parseInt(String(entityTypeId), 10);
    if (Number.isFinite(et) && et > 0) {
      setRuntimeEntityTypeIdOverride(et);
    }
  }

  try {
    const detail = await getTaskDetail(numId, {
      entityTypeId: entityTypeId ?? undefined,
    });
    const title =
      detail.title ||
      detail.TITLE ||
      detail.ufCrm94NgfTitulo ||
      detail.ufCrm100NgfTitulo ||
      `Item ${numId}`;

    return await runBitrixBddCycle(pkg, {
      tasks: [{ id: numId, title }],
      quiet,
    });
  } finally {
    clearRuntimeEntityTypeIdOverride();
  }
}

module.exports = { runBddForSingleCrmItem };
