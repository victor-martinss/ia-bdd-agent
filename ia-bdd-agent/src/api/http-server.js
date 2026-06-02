const http = require('http');
const fs = require('fs');
const path = require('path');
const { handleBitrixOutgoing } = require('./bitrix-outgoing-handler');
const { generateBDD } = require('../agents/bdd.agent');
const { pushBddToCrmCenariosQa } = require('../services/push-bdd-to-crm');
const {
  discoverBddLinkedTargets,
  shouldPushBddToMainCard,
  pushBddToAllLinkedDestinations,
} = require('../utils/bdd-push-routing');
const { resolveCanonicalBddForLinked } = require('../utils/bdd-canonical-for-linked');

const FIXTURES_PATH = path.join(__dirname, '../../fixtures/bdd-scenarios.json');
const MAX_BODY = 2 * 1024 * 1024;

/**
 * @param {Record<string, unknown>} body
 * @returns {null | { id: number } | { error: string }}
 */
function parseOptionalItemId(body) {
  if (!body || typeof body !== 'object') return null;
  const raw = body.itemId ?? body.crmItemId;
  if (raw == null || raw === '') return null;
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : Number(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return {
      error: 'itemId (ou crmItemId) deve ser um número inteiro positivo',
    };
  }
  return { id: Math.trunc(n) };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Webhook-Secret, X-Bitrix-Webhook-Token',
  });
  res.end(body);
}

function loadFixtures() {
  const raw = fs.readFileSync(FIXTURES_PATH, 'utf8');
  return JSON.parse(raw);
}

function findFixture(id) {
  const data = loadFixtures();
  const list = data.scenarios || [];
  return list.find((s) => s.id === id);
}

async function handle(req, res) {
  const host = req.headers.host || 'localhost';
  const u = new URL(req.url, `http://${host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Webhook-Secret, X-Bitrix-Webhook-Token',
    });
    return res.end();
  }

  try {
    const pathNorm = (u.pathname || '/').replace(/\/+$/, '') || '/';
    if (
      (pathNorm === '/webhooks/bitrix/outgoing' ||
        pathNorm === '/bitrix/outgoing') &&
      (req.method === 'GET' || req.method === 'POST')
    ) {
      return handleBitrixOutgoing(req, res, u);
    }

    if (u.pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, service: 'ia-bdd-agent-api' });
    }

    if (u.pathname === '/fixtures' && req.method === 'GET') {
      const { scenarios } = loadFixtures();
      return sendJson(res, 200, {
        fixtures: (scenarios || []).map((s) => ({ id: s.id, name: s.name })),
      });
    }

    if (u.pathname === '/bdd/from-item' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const item = body.item;
      if (!item || typeof item !== 'object') {
        return sendJson(res, 400, {
          error: 'body must include "item" (object)',
        });
      }
      const idCheck = parseOptionalItemId(body);
      if (idCheck && 'error' in idCheck) {
        return sendJson(res, 400, { error: idCheck.error });
      }
      const title = body.title || item.title || '';
      const bdd = await generateBDD(title, item);
      const payload = { bdd, title: title || item.title || null };
      if (idCheck && 'id' in idCheck) {
        const targets = await discoverBddLinkedTargets(idCheck.id, item);
        if (body.pushToCrm !== false && shouldPushBddToMainCard(targets)) {
          payload.crmItemId = idCheck.id;
          payload.crmPush = await pushBddToCrmCenariosQa(idCheck.id, bdd, {
            quiet: true,
            detail: item,
          });
        }
        if (body.pushToLinkedTasks !== false) {
          const canonical = resolveCanonicalBddForLinked(item, bdd);
          payload.linkedPush = await pushBddToAllLinkedDestinations(
            idCheck.id,
            canonical.bdd,
            item,
            { quiet: true }
          );
        }
      }
      return sendJson(res, 200, payload);
    }

    const fixtureMatch = u.pathname.match(/^\/bdd\/from-fixture\/([^/]+)\/?$/);
    if (fixtureMatch && req.method === 'POST') {
      const fixtureId = decodeURIComponent(fixtureMatch[1]);
      const fx = findFixture(fixtureId);
      if (!fx) {
        return sendJson(res, 404, { error: 'fixture not found', fixtureId });
      }
      const body = await readJsonBody(req);
      const idCheck = parseOptionalItemId(body);
      if (idCheck && 'error' in idCheck) {
        return sendJson(res, 400, { error: idCheck.error });
      }
      const title = fx.cardTitle || fx.item?.title || '';
      const bdd = await generateBDD(title, fx.item);
      const payload = {
        bdd,
        title,
        fixtureId: fx.id,
        fixtureName: fx.name,
      };
      if (idCheck && 'id' in idCheck) {
        const targets = await discoverBddLinkedTargets(idCheck.id, fx.item);
        if (body.pushToCrm !== false && shouldPushBddToMainCard(targets)) {
          payload.crmItemId = idCheck.id;
          payload.crmPush = await pushBddToCrmCenariosQa(idCheck.id, bdd, {
            quiet: true,
            detail: fx.item,
          });
        }
        if (body.pushToLinkedTasks !== false) {
          const canonical = resolveCanonicalBddForLinked(fx.item, bdd);
          payload.linkedPush = await pushBddToAllLinkedDestinations(
            idCheck.id,
            canonical.bdd,
            fx.item,
            { quiet: true }
          );
        }
      }
      return sendJson(res, 200, payload);
    }

    return sendJson(res, 404, {
      error: 'not found',
      hint:
        'GET /health | GET /fixtures | POST /bdd/from-item | POST /bdd/from-fixture/:id | POST /webhooks/bitrix/outgoing',
    });
  } catch (e) {
    return sendJson(res, 400, { error: e.message || String(e) });
  }
}

function start(port) {
  const p = Number(port) || Number(process.env.PORT) || 3050;
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, 500, { error: err.message || 'internal error' });
    });
  });
  server.listen(p, () => {
    console.log(`ia-bdd-agent API → http://localhost:${p}`);
    console.log('  GET  /health');
    console.log('  GET  /fixtures');
    console.log(
      '  POST /bdd/from-item  { "title"?, "item", "itemId"?, "pushToCrm"?, "pushToLinkedTasks"? }'
    );
    console.log(
      '  POST /bdd/from-fixture/:fixtureId  body opcional: { "itemId"?, "pushToCrm"?, "pushToLinkedTasks"? }'
    );
    console.log(
      '  POST /webhooks/bitrix/outgoing  — webhook Bitrix (saída) → BDD por item CRM'
    );
  });
  return server;
}

module.exports = {
  start,
  handle,
  loadFixtures,
  FIXTURES_PATH,
  parseOptionalItemId,
};
