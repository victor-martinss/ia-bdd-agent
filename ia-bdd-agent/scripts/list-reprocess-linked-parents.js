/**
 * Lista cards da fila que gravaram BDD no pai mas têm destinos atrelados (filhos CRM / QA / tarefas).
 * Uso: npm run bdd:list-reprocess-linked
 *      npm run bdd:list-reprocess-linked -- --hours=48
 */
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '../load-env'));

const { getTaskDetail } = require('../src/services/bitrix.service');
const {
  discoverBddLinkedTargets,
  isChildCrmItem,
} = require('../src/utils/bdd-push-routing');
const { bddQaStorageFirstFilledFieldKey } = require('../src/services/push-bdd-to-crm');
const { flattenCrmItem } = require('../src/services/crm-qa-stages');
const { parentIdFromItem } = require('../src/services/crm-item-links');

const OUTPUT = path.join(__dirname, '../output');

function parseHours(argv) {
  const flag = argv.find((a) => a.startsWith('--hours='));
  if (!flag) return 72;
  const n = Number.parseInt(flag.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 72;
}

function parseIds(argv) {
  const flag = argv.find((a) => a.startsWith('--ids='));
  if (!flag) return null;
  return flag
    .split('=')[1]
    .split(/[,;\s]+/)
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
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
  const argv = process.argv.slice(2);
  const hours = parseHours(argv);
  const forced = parseIds(argv);
  const ids = forced && forced.length ? forced : collectRecentItemIds(hours);
  console.log(
    forced && forced.length
      ? `Analisando ${ids.length} ID(s) informado(s): ${ids.join(', ')}\n`
      : `Itens com arquivo BDD gerado nas últimas ${hours}h: ${ids.length} (output/bdd-<id>-*.feature)\n`
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
    const fieldKey = bddQaStorageFirstFilledFieldKey(detail);
    const parentId = etId ? parentIdFromItem(flat, etId) : null;
    const isChild = etId ? isChildCrmItem(flat, etId) : false;

    const reprocessRow = {
      id,
      title: String(detail.title || flat.title || '').slice(0, 80),
      entityTypeId: etId,
      parentId,
      isChild,
      childCrm: targets.childCrmIds,
      linkedQa: targets.linkedQaCrmIds,
      bitrixTasks: targets.linkedBitrixTaskIds,
      mainHasBdd: Boolean(fieldKey),
      hasLinked: targets.hasLinkedDestinations,
    };

    console.log(`#${id} [SPA ${etId || '?'}] ${reprocessRow.title}`);
    if (parentId) console.log(`   Pai CRM: #${parentId}${isChild ? ' (este card é filho)' : ''}`);
    console.log(
      `   Atrelados: CRM filhos [${targets.childCrmIds.join(', ') || '—'}] | QA [${targets.linkedQaCrmIds.join(', ') || '—'}] | Tarefas [${targets.linkedBitrixTaskIds.join(', ') || '—'}]`
    );
    console.log(`   Campo BDD em #${id}: ${fieldKey || '(vazio)'}`);

    if (targets.hasLinkedDestinations) {
      reprocess.push(reprocessRow);
      console.log('   → Reprocessar este ID (pai) para gravar BDD nos atrelados\n');
    } else if (isChild && parentId) {
      reprocess.push({ ...reprocessRow, id: parentId, reprocessAsParent: true });
      console.log(`   → Sem atrelados aqui; reprocessar o PAI #${parentId}\n`);
    } else {
      console.log('   → Sem destinos atrelados detectados (BDD permanece neste card)\n');
    }
  }

  if (!reprocess.length) {
    console.log('Nenhum item recente com destinos atrelados encontrado.');
    return;
  }

  const idList = [...new Set(reprocess.map((r) => r.id))].join(',');
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
