/**
 * Uma execução: lista **todos** os itens do SPA no Bitrix (com paginação),
 * gera BDD e grava no campo configurado (ex.: Teste Q.A. / Cenários QA — ufCrm* / env).
 *
 * Atualiza também `output/poll-state.json` para que o `poll` não trate
 * esses IDs como "novos" de novo (use `--no-poll-state` para não tocar no estado).
 */
const path = require('path');

require(path.join(__dirname, '../load-env'));

const { getTasks } = require('../src/services/bitrix.service');
const { runBitrixBddCycle } = require('../src/orchestrator/run-bitrix-bdd-cycle');
const { loadPollState, savePollState } = require('../src/utils/poll-state');

const PKG = path.join(__dirname, '..');

function normId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

async function main() {
  const skipPollState = process.argv.includes('--no-poll-state');

  console.log('ia-bdd-agent — sincronizar BDD → CRM (toda a fila visível no Bitrix)\n');

  const tasks = await getTasks();
  console.log(`Itens retornados pela lista (paginada): ${tasks.length}\n`);

  const r = await runBitrixBddCycle(PKG, { tasks, quiet: false });

  if (!skipPollState && r.taskIds.length) {
    const state = loadPollState(PKG);
    const merged = new Set(state.processedIds.map(normId));
    for (const id of r.taskIds) merged.add(normId(id));
    state.processedIds = [...merged];
    state.lastPollAt = new Date().toISOString();
    state.lastNewTaskIds = r.taskIds;
    savePollState(PKG, state);
    console.log(
      '\nEstado do poll gravado: esses IDs não serão tratados como novos no próximo poll.'
    );
  } else if (skipPollState) {
    console.log('\n(--no-poll-state) Estado do poll não foi alterado.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
