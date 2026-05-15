/**
 * Gera BDD e grava no CRM + tarefas atreladas para um item específico (ignora poll-state).
 *
 * Uso: node scripts/run-bdd-item.js 360
 *      npm run bdd:item -- 360
 */
const path = require('path');
require(path.join(__dirname, '../load-env'));

const { getTaskDetail } = require('../src/services/bitrix.service');
const { runBitrixBddCycle } = require('../src/orchestrator/run-bitrix-bdd-cycle');

const PKG = path.join(__dirname, '..');
const itemId = Number.parseInt(process.argv[2] || '', 10);

async function main() {
  if (!Number.isFinite(itemId) || itemId <= 0) {
    console.error('Uso: npm run bdd:item -- <id_do_item_crm>');
    console.error('Ex.: npm run bdd:item -- 360');
    process.exit(1);
  }

  console.log(`Processando item CRM ${itemId} (fora do poll-state)…\n`);

  const detail = await getTaskDetail(itemId);
  const title = detail.title || detail.ufCrm94NgfTitulo || `Item ${itemId}`;

  const r = await runBitrixBddCycle(PKG, {
    tasks: [{ id: itemId, title }],
    quiet: false,
  });

  console.log('\n--- Resumo ---');
  console.log(`Processados: ${r.processed}`);
  console.log(`CRM: ${r.crm.ok} ok, ${r.crm.skipped} ignorado(s), ${r.crm.failed} falha(s)`);
  console.log(
    `Tarefas atreladas: ${r.linkedTasks.updated} gravada(s), ${r.linkedTasks.failed} falha(s)`
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
