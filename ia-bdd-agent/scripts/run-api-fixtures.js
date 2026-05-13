/**
 * Sobe a API em uma porta temporária e dispara POST para cada fixture
 * em fixtures/bdd-scenarios.json (massa de testes).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'fixtures', 'bdd-scenarios.json'), 'utf8')
);

const PORT = Number(process.env.API_TEST_PORT) || 3099;
const base = `http://127.0.0.1:${PORT}`;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function health() {
  const res = await fetch(`${base}/health`);
  return res.ok;
}

async function postFixture(id) {
  const res = await fetch(`${base}/bdd/from-fixture/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function assertBdd(data, scenario) {
  const bdd = data.bdd;
  if (typeof bdd !== 'string') throw new Error(`${scenario.id}: resposta sem string bdd`);
  if (bdd.includes('Não foi possível gerar BDD')) {
    throw new Error(`${scenario.id}: BDD não gerado: ${bdd.slice(0, 200)}`);
  }
  if (!bdd.includes('Funcionalidade:')) {
    throw new Error(`${scenario.id}: esperado trecho Gherkin "Funcionalidade:"`);
  }
}

async function main() {
  const child = spawn(process.execPath, [path.join(ROOT, 'api-server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });

  try {
    for (let i = 0; i < 40; i++) {
      try {
        if (await health()) break;
      } catch {
        /* ainda não subiu */
      }
      await wait(150);
      if (i === 39) throw new Error('API não respondeu a /health a tempo.\n' + stderr);
    }

    const scenarios = FIXTURES.scenarios || [];
    console.log(`Rodando ${scenarios.length} cenários contra ${base} …\n`);

    for (const s of scenarios) {
      const { ok, status, data } = await postFixture(s.id);
      if (!ok) {
        console.error(`FAIL ${s.id} HTTP ${status}`, data);
        process.exitCode = 1;
        continue;
      }
      try {
        assertBdd(data, s);
        console.log(`OK   ${s.id} — ${s.name}`);
      } catch (e) {
        console.error(`FAIL ${e.message}`);
        process.exitCode = 1;
      }
    }

    const fromItem = await fetch(`${base}/bdd/from-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Teste direto',
        item: scenarios[0].item,
      }),
    });
    const body = await fromItem.json();
    if (!fromItem.ok || !body.bdd) {
      console.error('FAIL POST /bdd/from-item', body);
      process.exitCode = 1;
    } else {
      console.log('OK   POST /bdd/from-item (payload manual)');
    }
  } finally {
    child.kill('SIGTERM');
    await wait(200);
    if (!child.killed) child.kill('SIGKILL');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
