const fs = require('fs');
const path = require('path');

function stateFilePath(packageRoot) {
  const custom = process.env.BDD_POLL_STATE_FILE;
  if (custom && String(custom).trim()) {
    const s = String(custom).trim();
    return path.isAbsolute(s) ? s : path.join(packageRoot, s);
  }
  return path.join(packageRoot, 'output', 'poll-state.json');
}

function loadPollState(packageRoot) {
  const p = stateFilePath(packageRoot);
  try {
    if (!fs.existsSync(p)) {
      return {
        processedIds: [],
        lastPollAt: null,
        lastNewTaskIds: [],
        lastQueueIds: [],
        lastScan: null,
      };
    }
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      processedIds: Array.isArray(data.processedIds) ? data.processedIds.map(Number) : [],
      lastPollAt: data.lastPollAt || null,
      lastNewTaskIds: Array.isArray(data.lastNewTaskIds) ? data.lastNewTaskIds : [],
      lastQueueIds: Array.isArray(data.lastQueueIds)
        ? data.lastQueueIds.map((id) => Number(id) || id)
        : [],
      lastScan: data.lastScan || null,
    };
  } catch {
    return {
      processedIds: [],
      lastPollAt: null,
      lastNewTaskIds: [],
      lastQueueIds: [],
      lastScan: null,
    };
  }
}

function savePollState(packageRoot, state) {
  const p = stateFilePath(packageRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const out = {
    processedIds: state.processedIds || [],
    lastPollAt: state.lastPollAt,
    lastNewTaskIds: state.lastNewTaskIds || [],
    lastQueueIds: state.lastQueueIds || [],
    lastScan: state.lastScan || null,
  };
  fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf8');
}

/** Remove IDs do estado (para reprocessar no poll). */
function removeIdsFromPollState(packageRoot, ids) {
  const state = loadPollState(packageRoot);
  const drop = new Set(ids.map((id) => Number(id)));
  state.processedIds = state.processedIds.filter((id) => !drop.has(Number(id)));
  savePollState(packageRoot, state);
  return state;
}

function parseForceIdsFromEnv() {
  const raw = (process.env.BDD_POLL_FORCE_IDS || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

module.exports = {
  loadPollState,
  savePollState,
  stateFilePath,
  removeIdsFromPollState,
  parseForceIdsFromEnv,
};
