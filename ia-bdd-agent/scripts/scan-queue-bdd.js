/**
 * Varre a fila QA e lista cards elegíveis cujo BDD não é publicável.
 * Uso: node scripts/scan-queue-bdd.js
 */
const path = require('path');
require(path.join(__dirname, '../load-env'));

const { getTasks, getTaskDetail } = require('../src/services/bitrix.service');
const { classifyBddQaItemActionAsync } = require('../src/services/push-bdd-to-crm');
const { generateBDD } = require('../src/agents/bdd.agent');
const { bddPodePublicarNoCrm } = require('../src/services/push-bdd-to-crm');

async function main() {
  const tasks = await getTasks();
  const problems = [];
  let ok = 0;

  for (const task of tasks) {
    const id = Number(task.id);
    let detail;
    try {
      detail = await getTaskDetail(id, { entityTypeId: task._entityTypeId });
    } catch (e) {
      problems.push({ id, et: task._entityTypeId, error: `crm.get: ${e.message}` });
      continue;
    }

    const cls = await classifyBddQaItemActionAsync(detail);
    if (cls.action !== 'generate' && cls.action !== 'merge') continue;

    const title = detail.title || detail.TITLE || task.title;
    try {
      const bdd = await generateBDD(title, detail);
      if (bddPodePublicarNoCrm(bdd)) {
        ok += 1;
      } else {
        problems.push({
          id,
          et: task._entityTypeId,
          error: 'bdd_nao_publicavel',
          len: bdd?.length || 0,
        });
      }
    } catch (e) {
      problems.push({ id, et: task._entityTypeId, error: e.message });
    }
  }

  console.log(`Fila: ${tasks.length} | geráveis OK: ${ok} | problemas: ${problems.length}`);
  for (const p of problems) {
    console.log(`  #${p.id} (SPA ${p.et}) — ${p.error}${p.len != null ? ` (${p.len} chars)` : ''}`);
  }
  process.exit(problems.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
