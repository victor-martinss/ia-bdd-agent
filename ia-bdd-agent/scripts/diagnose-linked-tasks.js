/**
 * Diagnóstico: vínculos CRM → tarefas Bitrix para um item.
 *
 * Uso: npm run bitrix:diagnose-linked -- 360
 */
const path = require('path');
require(path.join(__dirname, '../load-env'));

const {
  getEntityTypeId,
  getTaskDetail,
  getSpaSymbolCodeShortForEntityTypeId,
} = require('../src/services/bitrix.service');
const {
  bindingCandidates,
  listLinkedTaskIdsForCrmItem,
  discoverTaskBddFieldKeys,
  getTaskPayload,
} = require('../src/services/push-bdd-to-linked-tasks');

const itemId = Number.parseInt(process.argv[2] || '', 10);

async function main() {
  if (!Number.isFinite(itemId) || itemId <= 0) {
    console.error('Uso: npm run bitrix:diagnose-linked -- <id_item_crm>');
    process.exit(1);
  }

  if (!process.env.BITRIX_WEBHOOK) {
    console.error('Defina BITRIX_WEBHOOK no .env');
    process.exit(1);
  }

  const etId = await getEntityTypeId();
  const sym = await getSpaSymbolCodeShortForEntityTypeId(etId);
  const detail = await getTaskDetail(itemId);

  console.log(`\n--- Diagnóstico item CRM ${itemId} ---`);
  console.log(`entityTypeId: ${etId}`);
  console.log(`SYMBOL_CODE_SHORT (crm.type.list): ${sym || '(não encontrado — use BITRIX_SYMBOL_CODE_SHORT no .env)'}`);
  console.log('\nCandidatos UF_CRM_TASK:');
  for (const b of bindingCandidates(etId, itemId, sym)) {
    console.log(`  - ${b}`);
  }

  const taskIds = await listLinkedTaskIdsForCrmItem(itemId, detail);
  console.log(`\nTarefas Bitrix encontradas: ${taskIds.length ? taskIds.join(', ') : '(nenhuma)'}`);

  for (const tid of taskIds.slice(0, 5)) {
    const task = await getTaskPayload(tid);
    const ufs = discoverTaskBddFieldKeys(task);
    const link = task && (task.UF_CRM_TASK || task.ufCrmTask);
    console.log(`\n  Tarefa ${tid}:`);
    console.log(`    UF_CRM_TASK: ${JSON.stringify(link)}`);
    console.log(`    UFs cenários QA (auto): ${ufs.length ? ufs.join(', ') : '(nenhum — defina BITRIX_TASK_UF_BDD_FIELD)'}`);
  }

  if (!taskIds.length) {
    console.log('\nDicas:');
    console.log('  1. Abra a tarefa Bitrix atrelada → veja o valor exato em UF_CRM_TASK');
    console.log('  2. No .env: BITRIX_UF_CRM_TASK_VALUE={{symbol}}_{{id}}');
    console.log('  3. Se crm.type.list falhar: BITRIX_SYMBOL_CODE_SHORT=T82 (exemplo)');
    console.log('  4. Webhook precisa escopo task (tasks.task.list/get/update)');
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
