/**
 * Lista cards da fila que gravaram BDD no pai mas têm destinos atrelados (filhos CRM / QA / tarefas).
 * Uso: npm run bdd:list-reprocess-linked
 *      npm run bdd:list-reprocess-linked -- --hours=48
 */
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '../load-env'));

const { getTaskDetail } = require('../src/services/bitrix.service');
const { discoverBddLinkedTargets } = require('../src/utils/bdd-push-routing');
const {
  bddQaStorageFirstFilledFieldKey,
} = require('../services/push-bdd-to-crm');
const { flattenCrmItem } = require('../services/crm-qa-stages');

const OUTPUT = path.join(__dirname, '../output');

function parseHours(argv) {
  const flag = argv.find((a) => a.startsWith('--hours='));
  if (!flag) return 72;
  const n = Number.parseInt(flag.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 72;
}

function collectRecentItemIds(hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const ids = new Set();
  if (!fs.existsSync(OUTPUT)) return ids;
  for (const name of fs.readdirSync(OUTPUT)) {
    const m = name.match(/^bdd-(\d+)-/);
    if (!m) continue;
    const full = path.join(OUTPUT, name);
    try {
      const st = fs.statSync(full);
      if (st.mtimeMs >= cutoff) ids.add(Number(m[1]));
    } catch {
      /* ignore */
    }
  }
  return [...ids].sort((a, b) => a - b);
}

async function main() {
  const hours = parseHours(process.argv.slice(2));
  const ids = collectRecentItemIds(hours);
  console.log(
    `Itens com arquivo BDD gerado nas últimas ${hours}h: ${ids.length} (output/bdd-<id>-*.feature)\n`
  );

  const reprocess = [];
  for (const id of ids) {
    let detail;
    try {
      detail = await getTaskDetail(id);
    } catch (e) {
      console.log(`#${id} — erro ao ler CRM: ${e.message || e}`);
      continue;
    }
    const flat = flattenCrmItem(detail);
    const etId = Number(flat.entityTypeId || detail._entityTypeId || 0) || null;
    const targets = await discoverBddLinkedTargets(id, detail);
    if (!targets.hasLinkedDestinations) continue;

    const fieldKey = bddQaStorageFirstFilledFieldKey(detail);
    const reprocessRow = {
      id,
      title: String(detail.title || flat.title || '').slice(0, 80),
      entityTypeId: etId,
      childCrm: targets.childCrmIds,
      linkedQa: targets.linkedQaCrmIds,
      bitrixTasks: targets.linkedBitrixTaskIds,
      mainHasBdd: Boolean(fieldKey),
    };
    reprocess.push(reprocessRow);

    console.log(
      `#${id} [SPA ${etId || '?'}] ${reprocessRow.title}`
    );
    console.log(
      `   Atrelados: CRM filhos [${targets.childCrmIds.join(', ')}] | QA [${targets.linkedQaCrmIds.join(', ')}] | Tarefas [${targets.linkedBitrixTaskIds.join(', ')}]`
    );
    console.log(
      `   Campo BDD no card #${id}: ${fieldKey || '(vazio)'}`
    );
    console.log('');
  }

  if (!reprocess.length) {
    console.log('Nenhum item recente com destinos atrelados encontrado.');
    return;
  }

  const idList = reprocess.map((r) => r.id).join(',');
  console.log('--- Reprocessar (card pai → BDD nos atrelados) ---');
  console.log(`Total: ${reprocess.length}`);
  console.log(`\nBDD_POLL_FORCE_IDS=${idList}`);
  console.log('\nOu um a um:');
  for (const r of reprocess) {
    const et = r.entityTypeId ? ` ${r.entityTypeId}` : '';
    console.log(`  npm run bdd:item -- ${r.id}${et}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
