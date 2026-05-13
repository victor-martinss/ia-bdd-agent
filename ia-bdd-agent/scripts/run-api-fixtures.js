/**
 * Sobe a API em uma porta temporária e dispara POST para cada fixture
 * em fixtures/bdd-scenarios.json (massa de testes).
 *
 * Compatível com Node sem `fetch` global (usa apenas `http` nativo).
 * Porta: `API_TEST_PORT` no ambiente, senão aloca uma porta livre em 127.0.0.1
 * (evita falha quando 3099 já está em uso).
 *
 * Bitrix na API de teste: por padrão o subprocesso sobe com `BITRIX_WEBHOOK` vazio
 * (não lê webhook do `.env`), para respostas determinísticas. Para exercitar o portal
 * real no mesmo script: `API_TEST_INTEGRATION_BITRIX=1 npm run test:api`.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'fixtures', 'bdd-scenarios.json'), 'utf8')
);

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      srv.close((err) => {
        if (err) reject(err);
        else if (port) resolve(port);
        else reject(new Error('não foi possível obter porta livre'));
      });
    });
  });
}

function httpRequest(urlStr, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method,
      headers: { ...headers },
    };
    if (body != null && body !== '') {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      opts.headers['Content-Length'] = String(buf.length);
    } else if (method !== 'GET' && method !== 'HEAD') {
      opts.headers['Content-Length'] = '0';
    }

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          body: raw,
        });
      });
    });
    req.on('error', reject);
    if (body != null && body !== '') {
      req.write(Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'));
    }
    req.end();
  });
}

async function resolvePort() {
  const fromEnv = Number.parseInt(process.env.API_TEST_PORT || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return getFreePort();
}

let PORT;
let base;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function health() {
  const res = await httpRequest(`${base}/health`, { method: 'GET' });
  return res.ok;
}

async function postFixture(id) {
  const res = await httpRequest(
    `${base}/bdd/from-fixture/${encodeURIComponent(id)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }
  );
  let data = {};
  try {
    data = JSON.parse(res.body || '{}');
  } catch {
    data = {};
  }
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
  PORT = await resolvePort();
  base = `http://127.0.0.1:${PORT}`;

  const childEnv = { ...process.env, PORT: String(PORT) };
  if (process.env.API_TEST_INTEGRATION_BITRIX !== '1') {
    childEnv.BITRIX_WEBHOOK = '';
    delete childEnv.BITRIX_PUSH_BDD_TO_LINKED_TASKS;
  }

  const child = spawn(process.execPath, [path.join(ROOT, 'api-server.js')], {
    cwd: ROOT,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let stdout = '';
  child.stderr.on('data', (c) => {
    stderr += c.toString();
  });
  child.stdout.on('data', (c) => {
    stdout += c.toString();
  });

  try {
    for (let i = 0; i < 40; i++) {
      try {
        if (await health()) break;
      } catch {
        /* ainda não subiu */
      }
      await wait(150);
      if (i === 39) {
        throw new Error(
          `API não respondeu a /health a tempo (${base}).\n` +
            '--- stderr ---\n' +
            (stderr || '(vazio)') +
            '\n--- stdout ---\n' +
            (stdout || '(vazio)') +
            '\nDica: defina API_TEST_PORT para outra porta se houver conflito.'
        );
      }
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

    const payload = JSON.stringify({
      title: 'Teste direto',
      item: scenarios[0].item,
    });
    const fromItem = await httpRequest(`${base}/bdd/from-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    let body = {};
    try {
      body = JSON.parse(fromItem.body || '{}');
    } catch {
      body = {};
    }
    if (!fromItem.ok || !body.bdd) {
      console.error('FAIL POST /bdd/from-item', body);
      process.exitCode = 1;
    } else {
      console.log('OK   POST /bdd/from-item (payload manual)');
    }

    const firstItem = scenarios[0] && scenarios[0].item;
    const linkedPayload = JSON.stringify({
      title: 'Teste linkedTasksPush',
      item: firstItem,
      itemId: 424242,
      pushToCrm: false,
    });
    const linkedRes = await httpRequest(`${base}/bdd/from-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: linkedPayload,
    });
    let linkedBody = {};
    try {
      linkedBody = JSON.parse(linkedRes.body || '{}');
    } catch {
      linkedBody = {};
    }
    const integration = process.env.API_TEST_INTEGRATION_BITRIX === '1';
    try {
      if (!linkedRes.ok) {
        throw new Error(`HTTP ${linkedRes.status}`);
      }
      assertBdd(linkedBody, { id: 'from-item-linked' });
      if (linkedBody.crmPush !== undefined || linkedBody.crmItemId !== undefined) {
        throw new Error('com pushToCrm:false não deve retornar crmPush/crmItemId');
      }
      const ltp = linkedBody.linkedTasksPush;
      if (!ltp || typeof ltp !== 'object' || !Array.isArray(ltp.taskIds)) {
        throw new Error('resposta deve incluir linkedTasksPush com taskIds (array)');
      }
      if (!integration) {
        if (!ltp.skipped || ltp.reason !== 'BITRIX_WEBHOOK') {
          throw new Error(
            'sem integração Bitrix esperado linkedTasksPush.skipped e reason BITRIX_WEBHOOK'
          );
        }
      }
      console.log(
        'OK   POST /bdd/from-item (pushToCrm:false + itemId → linkedTasksPush)'
      );
    } catch (e) {
      console.error('FAIL from-item linkedTasksPush', e.message, linkedBody);
      process.exitCode = 1;
    }
  } finally {
    if (process.platform === 'win32') {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    } else {
      child.kill('SIGTERM');
    }
    await wait(200);
    if (!child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
