/**

 * Consulta a fila QA do Bitrix em loop e gera BDD conforme o estado do campo de cenários.

 *

 * A cada ciclo analisa **todos** os itens da fila (não só IDs nunca vistos):

 * • campo vazio → gera e grava BDD

 * • preenchido → ignora (log explícito)

 * • preenchido com marcador BITRIX_BDD_APPEND_MARKER → atualiza só o bloco [IA]

 *

 * Intervalo: BDD_POLL_INTERVAL_SECONDS ou BDD_POLL_INTERVAL_MINUTES (padrão 30s, mín. 10s).

 */

require('./load-env');



const { getTasks, getTaskDetail } = require('./src/services/bitrix.service');

const { classifyBddQaItemAction } = require('./src/services/push-bdd-to-crm');

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



function useLegacyProcessedIdsGate() {

  return process.env.BDD_POLL_LEGACY_PROCESSED_IDS === '1';

}



/**

 * @param {object[]} tasks

 * @param {Set<string|number>} forceSet

 */

async function scanQaQueue(tasks, forceSet) {

  const empty = [];

  const filled = [];

  const merge = [];

  const toProcess = [];

  const errors = [];



  for (const task of tasks) {

    const id = normId(task.id);

    let detail;

    try {

      detail = await getTaskDetail(task.id);

    } catch (e) {

      errors.push({ id, title: task.title, error: e.message || String(e) });

      continue;

    }



    const classification = classifyBddQaItemAction(detail);

    const row = { id, title: task.title, classification };



    if (forceSet.has(id)) {

      const forcedClass = {

        action: 'generate',

        fieldKey: classification.fieldKey,

        reason: 'reprocessamento forçado (BDD_POLL_FORCE_IDS)',

      };

      toProcess.push({

        ...task,

        _prefetchedDetail: detail,

        _classification: forcedClass,

      });

      empty.push({ ...row, classification: forcedClass });

      continue;

    }



    if (classification.action === 'generate') {

      empty.push(row);

      toProcess.push({ ...task, _prefetchedDetail: detail, _classification: classification });

    } else if (classification.action === 'merge') {

      merge.push(row);

      toProcess.push({ ...task, _prefetchedDetail: detail, _classification: classification });

    } else {

      filled.push(row);

    }

  }



  return {

    total: tasks.length,

    empty,

    filled,

    merge,

    toProcess,

    errors,

  };

}



function printQueueSummary(scan) {

  const ts = new Date().toISOString();

  console.log(`\n[${ts}] Fila QA: ${scan.total} item(ns)`);

  console.log(

    `  ○ Sem cenários (gerar BDD): ${scan.empty.length}${

      scan.empty.length

        ? ` — IDs ${scan.empty.map((r) => r.id).join(', ')}`

        : ''

    }`

  );

  console.log(

    `  ● Já preenchidos (ignorados): ${scan.filled.length}${

      scan.filled.length

        ? ` — IDs ${scan.filled

            .slice(0, 20)

            .map((r) => r.id)

            .join(', ')}${scan.filled.length > 20 ? '…' : ''}`

        : ''

    }`

  );

  if (scan.merge.length) {

    console.log(

      `  ◐ Com marcador (atualizar bloco IA): ${scan.merge.length} — IDs ${scan.merge

        .map((r) => r.id)

        .join(', ')}`

    );

  }

  if (scan.errors.length) {

    console.log(

      `  ✕ Erro ao ler CRM: ${scan.errors.map((e) => e.id).join(', ')}`

    );

  }

  const showDetail = scan.filled.length > 0 && scan.filled.length <= 12;

  if (showDetail) {

    for (const r of scan.filled) {

      const fk = r.classification.fieldKey ? ` (${r.classification.fieldKey})` : '';

      console.log(`      · ${r.id} — ${(r.title || 'sem título').slice(0, 72)}${fk}`);

      console.log(`        ↳ ${r.classification.reason}`);

    }

  }

}



async function tick() {

  const state = loadPollState(PKG);

  const forceIds = parseForceIdsFromEnv();

  const forceSet = new Set(forceIds.map(normId));



  if (forceIds.length) {

    removeIdsFromPollState(PKG, forceIds);

    console.log(`Reprocessamento forçado (BDD_POLL_FORCE_IDS): ${forceIds.join(', ')}`);

  }



  const tasks = await getTasks();

  const scan = await scanQaQueue(tasks, forceSet);



  printQueueSummary(scan);



  state.lastPollAt = new Date().toISOString();

  state.lastScan = {

    at: state.lastPollAt,

    total: scan.total,

    emptyIds: scan.empty.map((r) => r.id),

    filledIds: scan.filled.map((r) => r.id),

    mergeIds: scan.merge.map((r) => r.id),

  };



  let tasksToRun = scan.toProcess;



  if (useLegacyProcessedIdsGate()) {

    const seen = new Set((state.processedIds || []).map(normId));

    const before = tasksToRun.length;

    tasksToRun = tasksToRun.filter((t) => !seen.has(normId(t.id)));

    if (before !== tasksToRun.length) {

      console.log(

        `  (modo legado BDD_POLL_LEGACY_PROCESSED_IDS=1: ${before - tasksToRun.length} item(ns) já marcados em poll-state — pulados)`

      );

    }

  }



  if (process.env.BDD_POLL_REPROCESS_IN_QUEUE === '1') {

    tasksToRun = scan.toProcess;

    console.log('BDD_POLL_REPROCESS_IN_QUEUE=1 — todos os itens elegíveis serão processados.');

  }



  state.lastNewTaskIds = tasksToRun.map((t) => t.id);



  if (!tasksToRun.length) {

    savePollState(PKG, state);

    console.log('Nenhum item a gerar/atualizar neste ciclo.');

    return;

  }



  console.log(

    `\n▶ Gerando BDD para ${tasksToRun.length} item(ns): ${tasksToRun.map((t) => t.id).join(', ')}…`

  );



  const result = await runBitrixBddCycle(PKG, { tasks: tasksToRun, quiet: false });

  if (useLegacyProcessedIdsGate()) {

    const merged = new Set((state.processedIds || []).map(normId));

    for (const t of tasksToRun) {

      merged.add(normId(t.id));

    }

    state.processedIds = [...merged];

  }



  savePollState(PKG, state);

  console.log(

    `Ciclo concluído — ${result.processed} processado(s), CRM: ${result.crm.ok} gravado(s), ${result.crm.skipped} ignorado(s).`

  );

}



async function main() {

  const intervalMs = resolvePollIntervalMs();

  console.log('ia-bdd-agent — modo fila automática (varredura por estado do campo QA)');

  console.log(

    `Intervalo entre consultas: ${formatInterval(intervalMs)} (env: BDD_POLL_INTERVAL_SECONDS ou BDD_POLL_INTERVAL_MINUTES; padrão 30s, mín. 10s)`

  );

  console.log(`Estado: ${stateFilePath(PKG)}`);

  if (useLegacyProcessedIdsGate()) {

    console.log('Modo legado: BDD_POLL_LEGACY_PROCESSED_IDS=1 (só IDs novos em poll-state).');

  }

  console.log('Ctrl+C para encerrar.\n');



  for (;;) {

    await tick().catch(console.error);

    await new Promise((r) => setTimeout(r, intervalMs));

  }

}



main().catch(console.error);


