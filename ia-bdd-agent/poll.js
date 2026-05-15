/**
 * Consulta a fila do Bitrix em loop e gera BDD para IDs ainda não vistos
 * (persistidos em poll-state.json).
 *
 * Intervalo:
 * • BDD_POLL_INTERVAL_SECONDS tem prioridade (ex.: 15)
 * • senão BDD_POLL_INTERVAL_MINUTES (ex.: 1 ou 0.5)
 * • padrão: 30 segundos (quase tempo real sem martelar a API).
 * Mínimo: 10 segundos entre consultas.
 */
require('./load-env');

const { getTasks } = require('./src/services/bitrix.service');
const { runBitrixBddCycle } = require('./src/orchestrator/run-bitrix-bdd-cycle');
const {
  loadPollState,
  savePollState,
  stateFilePath,
  removeIdsFromPollState,
  parseForceIdsFromEnv,
} = require('./src/utils/poll-state');

const PKG = __dirname;
const MIN_INTERVAL_MS = 10_000;

function resolvePollIntervalMs() {
  const secRaw = (process.env.BDD_POLL_INTERVAL_SECONDS || '').trim();
  if (secRaw) {
    const s = Number.parseFloat(secRaw);
    if (Number.isFinite(s) && s > 0) {
      return Math.max(MIN_INTERVAL_MS, Math.round(s * 1000));
    }
  }
  const minRaw = (process.env.BDD_POLL_INTERVAL_MINUTES || '').trim();
  if (minRaw) {
    const m = Number.parseFloat(minRaw);
    if (Number.isFinite(m) && m > 0) {
      return Math.max(MIN_INTERVAL_MS, Math.round(m * 60 * 1000));
    }
  }
  return Math.max(MIN_INTERVAL_MS, 30 * 1000);
}

function formatInterval(ms) {
  if (ms < 60_000) return `${ms / 1000}s`;
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  return `${Math.round(ms / 1000)}s (${(ms / 60_000).toFixed(2)} min)`;
}

function normId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

async function tick() {
  const state = loadPollState(PKG);
  const seen = new Set(state.processedIds.map(normId));
  const forceIds = parseForceIdsFromEnv();

  if (forceIds.length) {
    removeIdsFromPollState(PKG, forceIds);
    forceIds.forEach((id) => seen.delete(normId(id)));
    console.log(`Reprocessamento forçado (BDD_POLL_FORCE_IDS): ${forceIds.join(', ')}`);
  }

  const tasks = await getTasks();
  let newTasks = tasks.filter((t) => !seen.has(normId(t.id)));

  if (process.env.BDD_POLL_REPROCESS_IN_QUEUE === '1') {
    newTasks = tasks;
    console.log('BDD_POLL_REPROCESS_IN_QUEUE=1 — todos os itens da fila serão processados.');
  }

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
  const intervalMs = resolvePollIntervalMs();
  console.log('ia-bdd-agent — modo fila automática');
  console.log(
    `Intervalo entre consultas: ${formatInterval(intervalMs)} (env: BDD_POLL_INTERVAL_SECONDS ou BDD_POLL_INTERVAL_MINUTES; padrão 30s, mín. 10s)`
  );
  console.log(`Estado: ${stateFilePath(PKG)}`);
  console.log('Ctrl+C para encerrar.\n');

  for (;;) {
    await tick().catch(console.error);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch(console.error);
