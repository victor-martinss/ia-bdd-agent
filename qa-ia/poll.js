/**
 * Consulta a fila do Bitrix a cada X minutos (padrão 15) e gera BDD
 * apenas para tarefas ainda não vistas (IDs persistidos em poll-state).
 */
require('./load-env');

const { getTasks } = require('./src/services/bitrix.service');
const { runBitrixBddCycle } = require('./src/orchestrator/run-bitrix-bdd-cycle');
const { loadPollState, savePollState, stateFilePath } = require('./src/utils/poll-state');

const PKG = __dirname;
const INTERVAL_MS =
  (Number(process.env.BDD_POLL_INTERVAL_MINUTES) || 15) * 60 * 1000;

function normId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

async function tick() {
  const state = loadPollState(PKG);
  const seen = new Set(state.processedIds.map(normId));

  const tasks = await getTasks();
  const newTasks = tasks.filter((t) => !seen.has(normId(t.id)));

  console.log(
    `\n[${new Date().toISOString()}] Fila: ${tasks.length} item(ns) | novas (ainda não processadas): ${newTasks.length}`
  );

  state.lastPollAt = new Date().toISOString();
  state.lastNewTaskIds = newTasks.map((t) => t.id);

  if (!newTasks.length) {
    savePollState(PKG, state);
    console.log('Nenhuma tarefa nova; estado atualizado.');
    return;
  }

  console.log(
    `IDs novos: ${newTasks.map((t) => t.id).join(', ')} — gerando BDD…`
  );

  await runBitrixBddCycle(PKG, { tasks: newTasks, quiet: false });

  const merged = new Set(state.processedIds.map(normId));
  for (const t of newTasks) {
    merged.add(normId(t.id));
  }
  state.processedIds = [...merged];
  savePollState(PKG, state);
  console.log(`Estado salvo (${state.processedIds.length} ID(s) já processados no total).`);
}

async function main() {
  const min = INTERVAL_MS / 60000;
  console.log('ia-bdd-agent — modo fila automática');
  console.log(`Intervalo: ${min} min (BDD_POLL_INTERVAL_MINUTES)`);
  console.log(`Estado: ${stateFilePath(PKG)}`);
  console.log('Ctrl+C para encerrar.\n');

  await tick().catch(console.error);
  setInterval(() => {
    tick().catch(console.error);
  }, INTERVAL_MS);
}

main().catch(console.error);
