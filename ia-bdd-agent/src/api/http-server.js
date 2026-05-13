const http = require('http');
const fs = require('fs');
const path = require('path');
const { generateBDD } = require('../agents/bdd.agent');

const FIXTURES_PATH = path.join(__dirname, '../../fixtures/bdd-scenarios.json');
const MAX_BODY = 2 * 1024 * 1024;

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
    'Access-Control-Allow-Headers': 'Content-Type',
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
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
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
        return sendJson(res, 400, { error: 'body must include "item" (object)' });
      }
      const title = body.title || item.title || '';
      const bdd = await generateBDD(title, item);
      return sendJson(res, 200, { bdd, title: title || item.title || null });
    }

    const fixtureMatch = u.pathname.match(/^\/bdd\/from-fixture\/([^/]+)\/?$/);
    if (fixtureMatch && req.method === 'POST') {
      const fixtureId = decodeURIComponent(fixtureMatch[1]);
      const fx = findFixture(fixtureId);
      if (!fx) {
        return sendJson(res, 404, { error: 'fixture not found', fixtureId });
      }
      const title = fx.cardTitle || fx.item?.title || '';
      const bdd = await generateBDD(title, fx.item);
      return sendJson(res, 200, { bdd, title, fixtureId: fx.id, fixtureName: fx.name });
    }

    return sendJson(res, 404, {
      error: 'not found',
      hint: 'GET /health | GET /fixtures | POST /bdd/from-item | POST /bdd/from-fixture/:id',
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
    console.log('  POST /bdd/from-item  { "title"?, "item": { ...crm } }');
    console.log('  POST /bdd/from-fixture/:fixtureId');
  });
  return server;
}

module.exports = { start, handle, loadFixtures, FIXTURES_PATH };
