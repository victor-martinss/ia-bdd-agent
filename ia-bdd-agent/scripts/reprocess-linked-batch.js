/**
 * Reprocessa cards pai (1276) e grava BDD nos cards QA atrelados (1294).
 * Uso: npm run bdd:reprocess-linked -- 40,86,128
 *      npm run bdd:reprocess-linked --   (usa BDD_POLL_FORCE_IDS ou lista padrão DICOM)
 */
const path = require('path');
require(path.join(__dirname, '../load-env'));

const { runBddForSingleCrmItem } = require('../src/services/bdd-from-item-runner');

/** Garante espelhamento pai→QA com BITRIX_SKIP desligado no batch. */
if (!process.env.BITRIX_LINKED_BDD_MIRROR_PARENT) {
  process.env.BITRIX_LINKED_BDD_MIRROR_PARENT = '1';
}
if (!process.env.BITRIX_LINKED_BDD_ALWAYS_SYNC) {
  process.env.BITRIX_LINKED_BDD_ALWAYS_SYNC = '1';
}

const PKG = path.join(__dirname, '..');

const DEFAULT_IDS = [40, 86, 128, 142, 264, 356];

function parseIds(argv) {
  const arg = argv.find((a) => !a.startsWith('--'));
  if (arg) {
    return arg
      .split(/[,;\s]+/)
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  const fromEnv = (process.env.BDD_POLL_FORCE_IDS || '').trim();
  if (fromEnv) {
    return fromEnv
      .split(/[,;\s]+/)
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  }
  return DEFAULT_IDS;
}

async function main() {
  const ids = parseIds(process.argv.slice(2));
  if (!ids.length) {
    console.error('Informe IDs: npm run bdd:reprocess-linked -- 40,86,128');
    process.exit(1);
  }

  if (process.env.BITRIX_SKIP_BDD_IF_QA_FILLED !== '0') {
    console.log(
      'Dica: para sobrescrever cards QA que já têm cenários, use BITRIX_SKIP_BDD_IF_QA_FILLED=0\n'
    );
  }

  console.log(`Reprocessando ${ids.length} card(s) pai → atrelados (SPA 1276)…\n`);

  const results = [];
  for (const itemId of ids) {
    console.log(`\n========== Item ${itemId} ==========`);
    try {
      const r = await runBddForSingleCrmItem(PKG, {
        itemId,
        entityTypeId: 1276,
        quiet: false,
      });
      results.push({
        itemId,
        ok: r.crm.ok > 0 || r.linkedTasks.updated > 0,
        crm: r.crm,
        linked: r.linkedTasks,
      });
    } catch (e) {
      console.error(`Erro item ${itemId}:`, e.message || e);
      results.push({ itemId, ok: false, error: e.message || String(e) });
    }
    const delay = Number.parseInt(process.env.BDD_POLL_ITEM_DELAY_MS || '500', 10);
    if (delay > 0) await new Promise((res) => setTimeout(res, delay));
  }

  console.log('\n--- Resumo batch ---');
  for (const row of results) {
    if (row.error) {
      console.log(`  #${row.itemId}: ERRO — ${row.error}`);
    } else {
      console.log(
        `  #${row.itemId}: CRM pai ${row.crm?.ok || 0} ok | atrelados ${row.linked?.updated || 0} gravado(s)`
      );
    }
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
