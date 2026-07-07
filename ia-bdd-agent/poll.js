/**
 * Fila QA Bitrix: varre todos os itens, destaca novos na fila e gera BDD na hora.
 *
 * • Novo na fila + campo vazio → alerta visual + gera BDD assim que a leitura do item termina
 * • Novo na fila + já preenchido → alerta visual (não altera)
 * • Horários nos logs: America/Sao_Paulo (BRT), não UTC
 */
require('./load-env');

const { getTasks, getTaskDetail } = require('./src/services/bitrix.service');
const { classifyBddQaItemActionAsync } = require('./src/services/push-bdd-to-crm');
const { runBitrixBddCycle } = require('./src/orchestrator/run-bitrix-bdd-cycle');
const { logTimestampBr, formatDateTimeBr, logTimezone } = require('./src/utils/datetime-br');
const {
  printNewInQueueAlert,
  printGeneratedSuccess,
  printGeneratedError,
  printCrmNotUpdated,
  printRootCause,
  printScanProgress,
  printCycleSummary,
} = require('./src/utils/poll-visual');
const { evaluateBddPollEligibility } = require('./src/utils/bdd-poll-eligibility');
const { diagnoseBddSkipRootCause } = require('./src/utils/bdd-skip-root-cause');
const { sleep } = require('./src/utils/bitrix-http-retry');
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

function taskQueueKey(task) {
  if (task && task._queueKey) return String(task._queueKey);
  const et = task && task._entityTypeId;
  const id = normId(task && task.id);
  return et ? `${et}:${id}` : String(id);
}

function useLegacyProcessedIdsGate() {
  return process.env.BDD_POLL_LEGACY_PROCESSED_IDS === '1';
}

function pollItemDelayMs() {
  const n = Number.parseInt(process.env.BDD_POLL_ITEM_DELAY_MS || '600', 10);
  return Number.isFinite(n) && n >= 0 ? n : 600;
}

/** Novos na fila, SPA 1294 e BDD_POLL_FORCE_IDS processam primeiro. */
function pollQueueEntityPriority(et) {
  const raw = (process.env.BDD_POLL_QUEUE_ENTITY_PRIORITY || '1294,1276').trim();
  const order = raw
    .split(/[,;\s]+/)
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const idx = order.indexOf(Number(et));
  return idx >= 0 ? idx : order.length;
}

function prioritizeQueueTasks(tasks, newInQueueSet, forceSet) {
  if (process.env.BDD_POLL_PRIORITY_NEW === '0') {
    return [...tasks].sort(
      (a, b) =>
        pollQueueEntityPriority(a._entityTypeId) - pollQueueEntityPriority(b._entityTypeId)
    );
  }
  const rank = (t) => {
    const id = normId(t.id);
    const key = taskQueueKey(t);
    const etPri = pollQueueEntityPriority(t._entityTypeId);
    if (forceSet.has(id)) return 0;
    if (newInQueueSet.has(key)) return 10 + etPri;
    return 100 + etPri;
  };
  return [...tasks].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return Number(b.id) - Number(a.id);
  });
}

function queueDelta(currentTasks, prevQueueIds, hasBaseline) {
  if (!hasBaseline) {
    return { newInQueue: [], removedFromQueue: [] };
  }
  const prev = new Set((prevQueueIds || []).map(String));
  const current = currentTasks.map((t) => taskQueueKey(t));
  const currentSet = new Set(current);
  return {
    newInQueue: current.filter((key) => !prev.has(key)),
    removedFromQueue: [...prev].filter((key) => !currentSet.has(key)),
  };
}

/**
 * @param {object[]} tasks
 * @param {Set<string|number>} forceSet
 * @param {Set<string|number>} newInQueueSet
 * @param {(index: number, total: number, task: object) => void} [onProgress]
 */
async function scanAndProcessQaQueue(tasks, forceSet, newInQueueSet, onProgress, legacySeen) {
  const empty = [];
  const filled = [];
  const merge = [];
  const errors = [];
  let generated = 0;
  let skippedFilled = 0;
  let skippedQaHistory = 0;
  const total = tasks.length;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const id = normId(task.id);
    const queueKey = taskQueueKey(task);
    if (onProgress) onProgress(i + 1, total, task);

    let detail;
    try {
      detail = await getTaskDetail(task.id, {
        entityTypeId: task._entityTypeId,
      });
      if (task._entityTypeId) detail._entityTypeId = task._entityTypeId;
    } catch (e) {
      errors.push({ id, title: task.title, error: e.message || String(e) });
      printGeneratedError(id, e.message || String(e));
      continue;
    }

    let classification = await classifyBddQaItemActionAsync(detail);
    const row = {
      id,
      title: task.title,
      classification,
      pipeline: task._pipelineName,
      entityTypeId: task._entityTypeId,
      queueKey,
    };
    const isNewInQueue = newInQueueSet.has(queueKey);

    if (forceSet.has(id)) {
      classification = {
        action: 'generate',
        fieldKey: classification.fieldKey,
        reason: 'reprocessamento forçado (BDD_POLL_FORCE_IDS)',
      };
      row.classification = classification;
    }

    if (isNewInQueue || forceSet.has(id)) {
      let eligibilityPreview = null;
      if (!forceSet.has(id) && (classification.action === 'generate' || classification.action === 'merge')) {
        try {
          eligibilityPreview = await evaluateBddPollEligibility(id, detail);
        } catch {
          eligibilityPreview = null;
        }
      }
      printNewInQueueAlert(row, eligibilityPreview);
    }

    if (classification.action === 'generate') {
      empty.push(row);
    } else if (classification.action === 'merge') {
      merge.push(row);
    } else if (classification.action === 'skip_qa_history') {
      filled.push(row);
      skippedQaHistory += 1;
      if (isNewInQueue) {
        const diagnosis = diagnoseBddSkipRootCause({ classification });
        printRootCause(id, diagnosis, { isNewInQueue: true });
      }
      continue;
    } else {
      filled.push(row);
      if (isNewInQueue) {
        skippedFilled += 1;
        const diagnosis = diagnoseBddSkipRootCause({ classification });
        printRootCause(id, diagnosis, { isNewInQueue: true });
      }
      continue;
    }

    let eligibility = null;
    if (!forceSet.has(id)) {
      try {
        eligibility = await evaluateBddPollEligibility(id, detail);
        if (!eligibility.proceed) {
          filled.push(row);
          if (isNewInQueue) skippedFilled += 1;
          const diagnosis = diagnoseBddSkipRootCause({ eligibility, classification });
          printRootCause(id, diagnosis, { isNewInQueue });
          continue;
        }
      } catch (e) {
        errors.push({ id, title: task.title, error: e.message || String(e) });
        const diagnosis = diagnoseBddSkipRootCause({
          error: `elegibilidade: ${e.message || e}`,
          classification,
        });
        printRootCause(id, diagnosis, { isNewInQueue });
        continue;
      }
    }

    if (
      !isNewInQueue &&
      !forceSet.has(id) &&
      (classification.action === 'generate' || classification.action === 'merge')
    ) {
      console.log(
        `${logTimestampBr()} ○ Item ${id} elegível (${classification.action === 'merge' ? 'atualizar IA' : 'sem cenários'}) — gerando…`
      );
    }

    if (
      useLegacyProcessedIdsGate() &&
      legacySeen &&
      legacySeen.has(id) &&
      !forceSet.has(id) &&
      process.env.BDD_POLL_REPROCESS_IN_QUEUE !== '1'
    ) {
      continue;
    }

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
      const gravado = result.crm.ok > 0 || (result.crm.linkedQa && result.crm.linkedQa > 0);
      if (gravado) {
        generated += 1;
        printGeneratedSuccess(row, { field: result.crm.lastField });
      } else {
        const diagnosis = diagnoseBddSkipRootCause({
          detail,
          bdd: result.lastBdd,
          classification,
          eligibility: result.eligibility || eligibility,
          crmResult: result.crm,
          linkedQaResult: result.linkedQaResult,
          publicavel: result.publicavel,
          generated: result.processed > 0,
          error: result.generationError,
        });
        if (result.crm.failed > 0) {
          printGeneratedError(id, diagnosis.reason);
        } else {
          printCrmNotUpdated(row, diagnosis.reason);
        }
        if (isNewInQueue || !gravado) {
          printRootCause(id, diagnosis, { isNewInQueue });
        }
      }
    } catch (e) {
      const diagnosis = diagnoseBddSkipRootCause({
        error: e.message || String(e),
        classification,
        eligibility,
      });
      printGeneratedError(id, diagnosis.reason);
      printRootCause(id, diagnosis, { isNewInQueue });
    }

    const delay = pollItemDelayMs();
    if (delay > 0 && i < tasks.length - 1) {
      await sleep(delay);
    }
  }

  return {
    total: tasks.length,
    empty,
    filled,
    merge,
    errors,
    generated,
    skippedFilled,
    skippedQaHistory,
  };
}

async function tick() {
  const state = loadPollState(PKG);
  const forceIds = parseForceIdsFromEnv();
  const forceSet = new Set(forceIds.map(normId));

  if (forceIds.length) {
    removeIdsFromPollState(PKG, forceIds);
    console.log(
      `${logTimestampBr()} Reprocessamento forçado (BDD_POLL_FORCE_IDS): ${forceIds.join(', ')}`
    );
  }

  const tasks = await getTasks();
  const hasBaseline =
    (state.lastQueueIds && state.lastQueueIds.length > 0) || !!state.lastPollAt;
  const delta = queueDelta(tasks, state.lastQueueIds, hasBaseline);
  const newInQueueSet = new Set(delta.newInQueue);
  const legacySeen = new Set((state.processedIds || []).map(normId));

  if (delta.newInQueue.length) {
    console.log(
      `\n${logTimestampBr()} ⚡ ${delta.newInQueue.length} teste(s) NOVO(S) detectado(s) na fila QA`
    );
  }

  const orderedTasks = prioritizeQueueTasks(tasks, newInQueueSet, forceSet);
  if (
    orderedTasks.length !== tasks.length ||
    orderedTasks.some((t, i) => taskQueueKey(t) !== taskQueueKey(tasks[i]))
  ) {
    const n = newInQueueSet.size;
    if (n > 0) {
      console.log(
        `${logTimestampBr()} Prioridade: ${n} novo(s) na fila processado(s) antes dos demais`
      );
    }
  }

  const scan = await scanAndProcessQaQueue(
    orderedTasks,
    forceSet,
    newInQueueSet,
    (index, total, task) => {
      if (process.env.BDD_POLL_QUIET_PROGRESS === '1') return;
      printScanProgress(index, total, task.id, task.title);
    },
    legacySeen
  );

  printCycleSummary(scan, delta);

  const nowBr = formatDateTimeBr();
  state.lastPollAt = nowBr;
  state.lastQueueIds = tasks.map((t) => taskQueueKey(t));
  state.lastScan = {
    at: nowBr,
    total: scan.total,
    emptyIds: scan.empty.map((r) => r.id),
    filledIds: scan.filled.map((r) => r.id),
    mergeIds: scan.merge.map((r) => r.id),
    newInQueueIds: delta.newInQueue,
  };
  state.lastNewTaskIds = [...scan.empty, ...scan.merge].map((r) => r.id);

  if (useLegacyProcessedIdsGate()) {
    const merged = new Set((state.processedIds || []).map(normId));
    for (const r of [...scan.empty, ...scan.merge]) {
      merged.add(normId(r.id));
    }
    state.processedIds = [...merged];
  }

  savePollState(PKG, state);

  if (scan.generated > 0) {
    console.log(
      `${logTimestampBr()} Ciclo OK — ${scan.generated} BDD gerado(s)/gravado(s).`
    );
  } else if (delta.newInQueue.length && scan.skippedFilled > 0) {
    console.log(
      `${logTimestampBr()} ${delta.newInQueue.length} novo(s) na fila; cenários QA já existiam (nenhuma gravação).`
    );
  } else if (!delta.newInQueue.length && !scan.empty.length && !scan.merge.length) {
    console.log(`${logTimestampBr()} Nenhuma alteração neste ciclo.`);
  }
}

async function main() {
  const intervalMs = resolvePollIntervalMs();
  console.log('ia-bdd-agent — fila QA (alertas visuais + geração imediata)');
  console.log(
    `Horário dos logs: ${logTimezone()} (${formatDateTimeBr()} agora)`
  );
  console.log(
    `Intervalo: ${formatInterval(intervalMs)} (BDD_POLL_INTERVAL_SECONDS / MINUTES)`
  );
  console.log(`Estado: ${stateFilePath(PKG)}`);
  if (useLegacyProcessedIdsGate()) {
    console.log('Modo legado: BDD_POLL_LEGACY_PROCESSED_IDS=1');
  }
  console.log('Ctrl+C para encerrar.\n');

  try {
    const { resolveAllStagesDetailed } = require('./src/services/crm-qa-stages');
    const { listEntityTypeIdsForQueue } = require('./src/services/bitrix.service');
    const queueSpas = await listEntityTypeIdsForQueue();
    const parentSpas = (process.env.BITRIX_PARENT_ENTITY_TYPE_IDS || '1272')
      .split(/[,;\s]+/)
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    for (const et of [...new Set([...queueSpas, ...parentSpas])]) {
      await resolveAllStagesDetailed(et);
    }
    console.log(
      `${logTimestampBr()} Cache de estágios carregado (SPAs ${[...new Set([...queueSpas, ...parentSpas])].join(', ')})`
    );
  } catch (e) {
    console.warn(`${logTimestampBr()} Aviso: cache de estágios parcial —`, e.message || e);
  }

  for (;;) {
    await tick().catch((err) => {
      console.error(`${logTimestampBr()} Erro no ciclo:`, err.message || err);
    });
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

main().catch(console.error);
