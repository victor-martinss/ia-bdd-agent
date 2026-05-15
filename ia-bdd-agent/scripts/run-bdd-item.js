/**
 * Gera BDD e grava no CRM + tarefas atreladas para um item específico (ignora poll-state).
 *
 * Uso: node scripts/run-bdd-item.js <id> [entityTypeId]
 *      npm run bdd:item -- 1110
 *      npm run bdd:item -- 1110 1294
 *      npm run bdd:item -- 1110 --et=1294
 */
const path = require('path');
require(path.join(__dirname, '../load-env'));

const { runBddForSingleCrmItem } = require('../src/services/bdd-from-item-runner');

const PKG = path.join(__dirname, '..');

function parseArgs(argv) {
  const itemId = Number.parseInt(argv[2] || '', 10);
  let entityTypeId = null;

  for (let i = 3; i < argv.length; i++) {
    const arg = String(argv[i] || '').trim();
    if (!arg) continue;
    const mFlag = arg.match(/^--(?:et|entity-type-id)=(\d+)$/i);
    if (mFlag) {
      entityTypeId = Number.parseInt(mFlag[1], 10);
      continue;
    }
    const n = Number.parseInt(arg, 10);
    if (Number.isFinite(n) && n > 0 && entityTypeId == null && n !== itemId) {
      entityTypeId = n;
    }
  }

  return { itemId, entityTypeId };
}

async function main() {
  const { itemId, entityTypeId } = parseArgs(process.argv);

  if (!Number.isFinite(itemId) || itemId <= 0) {
    console.error('Uso: npm run bdd:item -- <id_do_item> [entityTypeId_da_url]');
    console.error('Ex.: npm run bdd:item -- 1110 1294');
    console.error('     (URL …/type/1294/details/1110/ → id=1110, entityTypeId=1294)');
    process.exit(1);
  }

  if (entityTypeId != null) {
    console.log(
      `[Bitrix] entityTypeId=${entityTypeId} (argumento; .env será ignorado para este ID)\n`
    );
  }

  console.log(`Processando item CRM ${itemId} (fora do poll-state)…\n`);

  const r = await runBddForSingleCrmItem(PKG, {
    itemId,
    entityTypeId,
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
  const msg = e.message || String(e);
  console.error(msg);
  if (/não encontrado/i.test(msg)) {
    console.error('\nDica: na URL do Bitrix use os dois números:');
    console.error('  …/crm/type/1294/details/1110/  →  npm run bdd:item -- 1110 1294');
  }
  process.exit(1);
});
