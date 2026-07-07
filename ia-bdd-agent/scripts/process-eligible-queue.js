/**
 * Varre a fila (Novo Teste) e grava BDD nos cards elegíveis.
 * Uso: node scripts/process-eligible-queue.js
 *      node scripts/process-eligible-queue.js --dry-run
 */
const path = require('path');
require(path.join(__dirname, '../load-env'));

const PKG = path.join(__dirname, '..');
const { getTasks, getTaskDetail } = require('../src/services/bitrix.service');
const { classifyBddQaItemActionAsync } = require('../src/services/push-bdd-to-crm');
const { qaBddFieldTextFromFlat } = require('../src/services/push-bdd-to-crm');
const { flattenItem } = require('../src/agents/parser');
const { evaluateBddPollEligibility } = require('../src/utils/bdd-poll-eligibility');
const { resolveAllStagesDetailed } = require('../src/services/crm-qa-stages');
const { runBitrixBddCycle } = require('../src/orchestrator/run-bitrix-bdd-cycle');

const dryRun = process.argv.includes('--dry-run');
const spaArg = process.argv.find((a) => /^\d{4}$/.test(a));
const spaFilter = spaArg ? Number.parseInt(spaArg, 10) : null;

async function warmupStages() {
  for (const et of [1276, 1294, 1272]) {
    try {
      await resolveAllStagesDetailed(et);
    } catch {
      /* retry no próximo card */
    }
  }
}

async function main() {
  await warmupStages();

  let tasks;
  const maxAttempts = Number.parseInt(process.env.BDD_QUEUE_GET_TASKS_RETRIES || '12', 10);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      tasks = await getTasks();
      break;
    } catch (e) {
      console.warn(`getTasks tentativa ${i + 1}/${maxAttempts}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  if (!tasks) {
    console.error('Não foi possível ler a fila QA (Bitrix 503). Tente novamente.');
    process.exit(1);
  }

  const elegiveis = [];
  const tasksFiltered = spaFilter
    ? tasks.filter((t) => Number(t._entityTypeId) === spaFilter)
    : tasks;
  if (spaFilter) {
    console.log(`Filtro SPA ${spaFilter}: ${tasksFiltered.length} card(s) de ${tasks.length}`);
  }
  for (const task of tasksFiltered) {
    const id = Number(task.id);
    const et = task._entityTypeId;
    let detail;
    try {
      detail = await getTaskDetail(id, { entityTypeId: et });
      if (et) detail._entityTypeId = et;
    } catch (e) {
      console.warn(`#${id} leitura falhou: ${e.message}`);
      continue;
    }

    const classification = await classifyBddQaItemActionAsync(detail);
    if (classification.action !== 'generate' && classification.action !== 'merge') continue;

    const elig = await evaluateBddPollEligibility(id, detail);
    if (!elig.proceed) continue;

    const { text } = qaBddFieldTextFromFlat(flattenItem(detail));
    elegiveis.push({
      task,
      detail,
      classification,
      eligibility: elig,
      qaLen: (text || '').trim().length,
    });
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\nFila: ${tasks.length} card(s) | elegíveis para gravar: ${elegiveis.length}`);

  elegiveis.sort((a, b) => {
    if (a.qaLen === 0 && b.qaLen > 0) return -1;
    if (b.qaLen === 0 && a.qaLen > 0) return 1;
    return Number(b.task.id) - Number(a.task.id);
  });

  if (!elegiveis.length) {
    console.log('Nenhum card elegível com campo vazio ou BDD inválido para reescrita.');
    return;
  }

  for (const row of elegiveis) {
    const { task, classification, qaLen } = row;
    console.log(
      `  #${task.id} SPA ${task._entityTypeId} | ${classification.action} | QA ${qaLen ? qaLen + ' chars' : 'vazio'}`
    );
  }

  if (dryRun) {
    console.log('\n(dry-run — nenhuma gravação)');
    return;
  }

  let ok = 0;
  let fail = 0;
  for (const row of elegiveis) {
    const { task, detail, classification, eligibility } = row;
    console.log(`\n========== Processando #${task.id} ==========`);
    try {
      const result = await runBitrixBddCycle(PKG, {
        tasks: [
          {
            ...task,
            _prefetchedDetail: detail,
            _classification: classification,
            _pollEligibility: eligibility,
            _queueKey: task._queueKey,
          },
        ],
        quiet: false,
      });
      if (result.crm.ok > 0 || (result.crm.linkedQa && result.crm.linkedQa > 0)) {
        ok += 1;
        console.log(`✓ #${task.id} gravado`);
      } else {
        fail += 1;
        console.warn(`✗ #${task.id} não gravado (skipped=${result.crm.skipped})`);
      }
    } catch (e) {
      fail += 1;
      console.error(`✗ #${task.id}: ${e.message || e}`);
    }
    const delay = Number.parseInt(process.env.BDD_POLL_ITEM_DELAY_MS || '1200', 10);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }

  console.log(`\n--- Resumo: ${ok} gravado(s), ${fail} falha(s) / ignorado(s) ---`);
  process.exit(fail > 0 && ok === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
