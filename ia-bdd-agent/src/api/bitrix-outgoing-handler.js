/**
 * Handler para webhook **de saída** / automação Bitrix POST → disparo imediato de BDD por item CRM.
 */

const querystring = require('querystring');
const path = require('path');

const PKG = path.join(__dirname, '..', '..');
const { runBddForSingleCrmItem } = require('../services/bdd-from-item-runner');

/** Fila simples: evita corrida no entityTypeId em runtime com POSTs paralelos. */
let bddOutgoingQueue = Promise.resolve();

function queueBddWebhookTask(fn) {
  bddOutgoingQueue = bddOutgoingQueue
    .then(() => fn())
    .catch((e) => {
      console.error('[webhook Bitrix fila]', e.message || e);
    });
  return bddOutgoingQueue;
}

const MAX_BODY =
  Number.parseInt(process.env.BDD_OUTGOING_MAX_BODY_BYTES || '2097152', 10) ||
  2097152;

/** @typedef {{ itemId?: number|null, entityTypeId?: number|null }} ExtractedIds */

/** @param {...Record<string, unknown>} pairs */
/** @returns {ExtractedIds} */
function pickPositiveInts(...pairs) {
  let itemId = null;
  let entityTypeId = null;

  const tryNum = (v) => {
    if (v == null || v === '') return null;
    const n =
      typeof v === 'number' && Number.isFinite(v)
        ? Math.trunc(v)
        : Number.parseInt(String(v).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  for (const p of pairs) {
    if (!p || typeof p !== 'object') continue;
    if (itemId == null) itemId = tryNum(p.itemId ?? p.crmItemId ?? p.ID ?? p.id);
    if (entityTypeId == null) {
      entityTypeId = tryNum(
        p.entityTypeId ?? p.ENTITY_TYPE_ID ?? p.entity_type_id
      );
    }
  }
  return { itemId, entityTypeId };
}

function getDeep(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Extrai id do item CRM e entityTypeId de vários formatos Bitrix / automação.
 * @param {Record<string, string>} queryUrl - searchParams da URL
 * @param {unknown} bodyJson
 * @param {Record<string, string>} flatForm
 */
function extractCrmIdsFromOutgoing(queryUrl, bodyJson, flatForm) {
  const qLookup = queryUrl && typeof queryUrl === 'object' ? queryUrl : {};
  const form = flatForm && typeof flatForm === 'object' ? flatForm : {};

  const q = (k) => {
    const v = qLookup[k];
    return v != null && v !== '' ? v : null;
  };

  let itemId = null;
  let entityTypeId = null;

  const tryPair = (o) => {
    const p = pickPositiveInts(o);
    if (itemId == null && p.itemId != null) itemId = p.itemId;
    if (entityTypeId == null && p.entityTypeId != null) {
      entityTypeId = p.entityTypeId;
    }
  };

  tryPair({
    itemId: q('crmItemId') || q('id') || q('crm_id') || q('DOCUMENT_ID'),
    entityTypeId: q('entityTypeId'),
  });

  Object.keys(form).forEach((key) => {
    const v = form[key];
    const kl = key.toLowerCase();
    if (kl === 'id' || kl.endsWith('[id]')) {
      const n = Number.parseInt(String(v).trim(), 10);
      if (!itemId && Number.isFinite(n) && n > 0) itemId = n;
    }
    if (kl.includes('entity_type') && kl.includes('id')) {
      const n = Number.parseInt(String(v).trim(), 10);
      if (!entityTypeId && Number.isFinite(n) && n > 0) entityTypeId = n;
    }
  });

  Object.keys(form).forEach((key) => {
    const v = form[key];
    if (/data\[fields\]\[id\]|data\[FIELDS\]\[ID\]|\[FIELDS\]\[ID\]|fields\[id\]/i.test(key)) {
      const n = Number.parseInt(String(v).trim(), 10);
      if (Number.isFinite(n) && n > 0) itemId = n;
    }
    if (
      /data\[fields\]\[ENTITY_TYPE_ID\]|data\[FIELDS\]\[ENTITY_TYPE_ID\]/i.test(
        key
      )
    ) {
      const n = Number.parseInt(String(v).trim(), 10);
      if (Number.isFinite(n) && n > 0) entityTypeId = n;
    }
  });

  if (bodyJson != null && typeof bodyJson === 'object') {
    tryPair(bodyJson);

    tryPair(bodyJson.data);
    if (bodyJson.data && typeof bodyJson.data === 'object') {
      tryPair(bodyJson.data.FIELDS || bodyJson.data.fields || bodyJson.data);
    }

    const docId =
      bodyJson.data?.DOCUMENT_ID || bodyJson.DOCUMENT_ID || bodyJson.document_id;
    if (docId != null) {
      if (Array.isArray(docId)) {
        const last = docId[docId.length - 1];
        const n = Number.parseInt(String(last).trim(), 10);
        if (!itemId && Number.isFinite(n) && n > 0) itemId = n;
      } else {
        const n = Number.parseInt(String(docId).trim(), 10);
        if (!itemId && Number.isFinite(n) && n > 0) itemId = n;
      }
    }

    const bid = getDeep(bodyJson, ['data', 'FIELDS', 'ID']);
    if (bid != null && !itemId) {
      const n = Number.parseInt(String(bid).trim(), 10);
      if (Number.isFinite(n) && n > 0) itemId = n;
    }
    const bet = getDeep(bodyJson, ['data', 'FIELDS', 'ENTITY_TYPE_ID']);
    if (bet != null && entityTypeId == null) {
      const n = Number.parseInt(String(bet).trim(), 10);
      if (Number.isFinite(n) && n > 0) entityTypeId = n;
    }
  }

  return { itemId, entityTypeId };
}

async function readBodyRaw(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

/** @returns {Promise<{ bodyJson?: object, flatForm: Record<string,string> }>} */
async function parseIncomingBody(req) {
  const raw = (await readBodyRaw(req)).trim();
  const ct = (req.headers['content-type'] || '').toLowerCase();

  /** @type {Record<string,string>} */
  let flatForm = {};

  if (!raw) {
    return { flatForm };
  }

  if (ct.includes('application/json')) {
    try {
      return { bodyJson: JSON.parse(raw), flatForm };
    } catch {
      return { flatForm };
    }
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    flatForm = { ...flatForm, ...querystring.parse(raw) };
    for (const [k, v] of Object.entries(flatForm)) {
      flatForm[k] = Array.isArray(v) ? String(v[0]) : String(v);
    }

    try {
      const blob = flatForm.payload || flatForm.data;
      if (blob && /^[\[{]/.test(String(blob))) {
        return { bodyJson: JSON.parse(String(blob)), flatForm };
      }
    } catch {
      /* ignorar */
    }
    return { flatForm };
  }

  try {
    return { bodyJson: JSON.parse(raw), flatForm };
  } catch {
    flatForm = { ...flatForm, ...querystring.parse(raw) };
    for (const [k, v] of Object.entries(flatForm)) {
      flatForm[k] = Array.isArray(v) ? String(v[0]) : String(v);
    }
    return { flatForm };
  }
}

function queryObjectFromUrl(u) {
  /** @type {Record<string,string>} */
  const o = {};
  u.searchParams.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

function verifyOutgoingSecret(req, u) {
  const secret = (process.env.BITRIX_OUTGOING_WEBHOOK_SECRET || '').trim();
  if (!secret) return true;

  const auth = (req.headers.authorization || '').trim();
  const headerToken =
    (req.headers['x-webhook-secret'] ||
      req.headers['x-bitrix-webhook-token'] ||
      '') + '';
  const qTok = u.searchParams.get('token') || '';

  if (auth === `Bearer ${secret}` || auth === secret) return true;
  if (String(headerToken).trim() === secret) return true;
  if (process.env.BITRIX_OUTGOING_ALLOW_QUERY_TOKEN === '1' && qTok === secret) {
    return true;
  }

  return false;
}

async function handleBitrixOutgoing(req, res, u) {
  const sendJsonLocal = (
    /** @type {import('http').ServerResponse} */ r,
    status,
    obj
  ) => {
    const body = JSON.stringify(obj);
    r.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, X-Webhook-Secret, X-Bitrix-Webhook-Token',
    });
    r.end(body);
  };

  try {
    if (req.method === 'GET') {
      return sendJsonLocal(res, 200, {
        ok: true,
        hint: 'POST com payload do Bitrix para gerar BDD no item CRM',
        path: '/webhooks/bitrix/outgoing',
      });
    }

    if (req.method !== 'POST') {
      return sendJsonLocal(res, 405, { error: 'use POST ou GET este endpoint' });
    }

    if (!verifyOutgoingSecret(req, u)) {
      return sendJsonLocal(res, 401, {
        error: 'unauthorized',
        hint:
          'Use Authorization: Bearer <secret>, ou header X-Webhook-Secret / X-Bitrix-Webhook-Token igual a BITRIX_OUTGOING_WEBHOOK_SECRET.',
      });
    }

    const qObj = queryObjectFromUrl(u);
    const { bodyJson, flatForm } = await parseIncomingBody(req);
    let { itemId, entityTypeId } = extractCrmIdsFromOutgoing(
      qObj,
      bodyJson,
      flatForm
    );

    if (itemId == null) {
      const keys = [...Object.keys(qObj), ...Object.keys(flatForm)].slice(
        0,
        40
      );
      return sendJsonLocal(res, 400, {
        error: 'não foi possível extrair o ID do item CRM do payload',
        hint: `Inclua crmItemId na URL (?crmItemId=…) ou um corpo JSON { "crmItemId": N }. Chaves vistas: ${keys.join(', ')}`,
        doc: 'Veja README.md — seção «Webhook de saída Bitrix»',
      });
    }

    const payload = {
      ok: true,
      accepted: true,
      itemId,
      entityTypeId: entityTypeId ?? undefined,
      mode:
        process.env.BITRIX_OUTGOING_PROCESS_SYNC === '1' ? 'sync' : 'async',
    };

    const runner = async () => {
      try {
        console.log(
          `\n[webhook Bitrix] BDD iniciado para item CRM ${itemId}` +
            (entityTypeId != null ? ` (entityTypeId=${entityTypeId})` : '')
        );
        const r = await runBddForSingleCrmItem(PKG, {
          itemId,
          entityTypeId,
          quiet: false,
        });
        console.log(
          `[webhook Bitrix] Concluído item ${itemId}: CRM ok=${r.crm.ok}, linkedTasks=${r.linkedTasks.updated}`
        );
      } catch (e) {
        console.error(`[webhook Bitrix] Erro item ${itemId}:`, e.message || e);
      }
    };

    if (process.env.BITRIX_OUTGOING_PROCESS_SYNC === '1') {
      await runner();
      return sendJsonLocal(res, 200, {
        ...payload,
        processed: true,
      });
    }

    setImmediate(() => {
      queueBddWebhookTask(runner);
    });

    return sendJsonLocal(res, 200, payload);
  } catch (e) {
    return sendJsonLocal(res, 400, {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

module.exports = {
  handleBitrixOutgoing,
  extractCrmIdsFromOutgoing,
};
