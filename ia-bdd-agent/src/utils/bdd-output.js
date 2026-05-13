const fs = require('fs');
const path = require('path');

function resolveOutputDir(packageRoot) {
  const raw = process.env.BDD_OUTPUT_DIR;
  if (raw === '0' || raw === 'false') return null;
  const rel = raw && String(raw).trim() !== '' ? String(raw).trim() : 'output';
  return path.isAbsolute(rel) ? rel : path.join(packageRoot, rel);
}

function slugTitle(title) {
  return String(title || 'task')
    .replace(/[^a-z0-9-_]+/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'task';
}

function writeBddArtifacts(packageRoot, { taskId, title, bdd }, aggregatePath) {
  const dir = resolveOutputDir(packageRoot);
  if (!dir) return { dir: null, file: null, aggregatePath: null };

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bdd-${taskId}-${slugTitle(title)}.feature`);
  fs.writeFileSync(file, bdd, 'utf8');
  if (aggregatePath) {
    const block = `\n# =============================================================================\n# Task ${taskId} — ${String(title).replace(/\n/g, ' ')}\n# =============================================================================\n\n${bdd}\n`;
    fs.appendFileSync(aggregatePath, block, 'utf8');
  }
  return { dir, file, aggregatePath };
}

function initAggregateFile(packageRoot) {
  const dir = resolveOutputDir(packageRoot);
  if (!dir) return null;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aggregatePath = path.join(dir, `bdd-todas-${stamp}.feature`);
  const header = `# BDD — execução ${new Date().toISOString()}\n# Um arquivo por chamado + este consolidado.\n\n`;
  fs.writeFileSync(aggregatePath, header, 'utf8');
  return aggregatePath;
}

module.exports = { resolveOutputDir, writeBddArtifacts, initAggregateFile };
