/**
 * Garante uma única instância de poll.js (encerra duplicatas ao subir).
 * Desligar: BDD_POLL_ALLOW_MULTIPLE=1
 */
const { execSync } = require('child_process');

function listOtherPollJsPids() {
  const myPid = process.pid;
  if (process.platform === 'win32') {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'poll\\\\.js' } | ForEach-Object { $_.ProcessId }"`,
        { encoding: 'utf8', timeout: 15000 }
      );
      return out
        .trim()
        .split(/\r?\n/)
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0 && n !== myPid);
    } catch {
      return [];
    }
  }
  try {
    const out = execSync("pgrep -f 'ia-bdd-agent/poll\\.js' 2>/dev/null || true", {
      encoding: 'utf8',
      shell: true,
      timeout: 10000,
    });
    return out
      .trim()
      .split(/\s+/)
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n !== myPid);
  } catch {
    return [];
  }
}

/** @returns {{ killed: number[] }} */
function terminateDuplicatePollInstances() {
  if (process.env.BDD_POLL_ALLOW_MULTIPLE === '1') {
    return { killed: [] };
  }
  const killed = [];
  for (const pid of listOtherPollJsPids()) {
    try {
      process.kill(pid, 'SIGTERM');
      killed.push(pid);
    } catch {
      /* processo já encerrou */
    }
  }
  return { killed };
}

module.exports = {
  listOtherPollJsPids,
  terminateDuplicatePollInstances,
};
