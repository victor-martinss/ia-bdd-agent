require('../../load-env');
const axios = require('axios');
const { flattenItem, isMeaningful } = require('../agents/parser');

const BASE_URL = process.env.BITRIX_WEBHOOK;

const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i;

function restErrorMessage(data) {
  if (!data || typeof data !== 'object') return '';
  if (data.error) {
    return (
      (data.error_description && String(data.error_description)) ||
      String(data.error)
    );
  }
  return '';
}

function classificarArquivo(nome, mime) {
  const n = String(nome || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (IMG_EXT.test(n) || m.startsWith('image/')) return 'image';
  if (VIDEO_EXT.test(n) || m.startsWith('video/')) return 'video';
  return 'other';
}

/** Extrai URLs de imagens/vídeos embutidas em HTML dos campos UF. */
function extrairMidiaDeHtml(item) {
  const flat = flattenItem(item || {});
  const found = [];
  const seen = new Set();

  for (const val of Object.values(flat)) {
    const html = Array.isArray(val) ? val.join(' ') : String(val || '');
    if (!html || html.length < 10) continue;

    const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html))) {
      const url = m[1].trim();
      if (!url.startsWith('http') || seen.has(url)) continue;
      const tipo = classificarArquivo(url);
      if (tipo === 'image' || tipo === 'video') {
        seen.add(url);
        found.push({ url, name: url.split('/').pop() || 'anexo', type: tipo, source: 'html' });
      }
    }
  }
  return found;
}

/** Campos UF que costumam guardar links de evidência. */
function extrairLinksDeCampos(item) {
  const flat = flattenItem(item || {});
  const found = [];
  const seen = new Set();

  for (const [k, v] of Object.entries(flat)) {
    const lower = k.toLowerCase();
    if (!/(evid|anexo|arquivo|file|imagem|video|print|screenshot|anex)/i.test(lower)) {
      continue;
    }
    const text = Array.isArray(v) ? v.map(String).join('\n') : String(v || '');
    if (!isMeaningful(text)) continue;

    const urls = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      const tipo = classificarArquivo(url);
      found.push({
        url,
        name: url.split('/').pop() || k,
        type: tipo === 'other' ? 'file' : tipo,
        source: `field:${k}`,
      });
    }
  }
  return found;
}

async function listTimelineFiles(entityTypeId, itemId) {
  if (!BASE_URL) return [];
  const et = Number(entityTypeId);
  const id = Number(itemId);
  if (!Number.isFinite(et) || !Number.isFinite(id)) return [];

  const entityTypes = [
    `dynamic_${et}`,
    `CRM_DYNAMIC_${et}`,
    `DYNAMIC_${et}`,
  ];

  const out = [];
  const seen = new Set();

  for (const entityType of entityTypes) {
    try {
      const res = await axios.post(
        `${BASE_URL}/crm.timeline.comment.list`,
        {
          filter: { ENTITY_ID: id, ENTITY_TYPE: entityType },
          order: { ID: 'DESC' },
          select: ['ID', 'COMMENT', 'FILES'],
        },
        { validateStatus: (s) => s >= 200 && s < 500, timeout: 20000 }
      );
      if (restErrorMessage(res.data)) continue;

      const rows = res.data?.result || [];
      for (const row of rows) {
        const files = row.FILES || row.files || [];
        const list = Array.isArray(files) ? files : Object.values(files || {});
        for (const f of list) {
          const url =
            f.urlDownload || f.DOWNLOAD_URL || f.downloadUrl || f.viewUrl || f.url;
          const name = f.name || f.NAME || f.fileName || 'timeline-anexo';
          const idFile = f.id || f.ID;
          const key = url || String(idFile);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({
            id: idFile,
            url,
            urlPreview: f.urlPreview || f.URL_PREVIEW || '',
            urlShow: f.urlShow || f.URL_SHOW || '',
            name,
            type: classificarArquivo(name, f.type),
            source: 'timeline',
          });
        }
      }
      if (out.length) break;
    } catch {
      /* próximo entityType */
    }
  }
  return out;
}

async function listDiskAttached(entityTypeId, itemId) {
  if (!BASE_URL) return [];
  const et = Number(entityTypeId);
  const id = Number(itemId);
  if (!Number.isFinite(et) || !Number.isFinite(id)) return [];

  try {
    const res = await axios.post(
      `${BASE_URL}/disk.attachedObject.list`,
      {
        filter: {
          MODULE_ID: 'crm',
          ENTITY_TYPE_ID: `DYNAMIC_${et}`,
          ENTITY_ID: id,
        },
      },
      { validateStatus: (s) => s >= 200 && s < 500, timeout: 20000 }
    );
    if (restErrorMessage(res.data)) return [];

    const rows = res.data?.result || [];
    return rows
      .map((r) => {
        const name = r.NAME || r.name || 'anexo';
        return {
          id: r.OBJECT_ID || r.objectId || r.ID,
          name,
          type: classificarArquivo(name),
          source: 'disk',
        };
      })
      .filter((r) => r.id);
  } catch {
    return [];
  }
}

/**
 * @param {object} item
 * @param {{ entityTypeId?: number, itemId?: number }} meta
 */
async function listEvidenceFromCrmItem(item, meta = {}) {
  const flat = flattenItem(item || {});
  const itemId = meta.itemId ?? flat.id ?? flat.ID;
  const entityTypeId =
    meta.entityTypeId ?? flat._entityTypeId ?? flat.entityTypeId;

  const merged = [];
  const seen = new Set();

  const push = (e) => {
    const key = e.url || String(e.id || e.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(e);
  };

  for (const e of extrairMidiaDeHtml(item)) push(e);
  for (const e of extrairLinksDeCampos(item)) push(e);

  if (itemId && entityTypeId) {
    for (const e of await listTimelineFiles(entityTypeId, itemId)) push(e);
    for (const e of await listDiskAttached(entityTypeId, itemId)) push(e);
  }

  return merged;
}

/**
 * Baixa arquivo do Bitrix (disk.file.get) como buffer — para imagens na visão.
 */
async function downloadDiskFile(fileId) {
  if (!BASE_URL || !fileId) return null;
  try {
    const res = await axios.post(
      `${BASE_URL}/disk.file.get`,
      { id: fileId },
      { validateStatus: (s) => s >= 200 && s < 500, timeout: 30000 }
    );
    if (restErrorMessage(res.data)) return null;
    const url =
      res.data?.result?.DOWNLOAD_URL ||
      res.data?.result?.downloadUrl ||
      res.data?.result?.DETAIL_URL;
    if (!url) return null;

    const bin = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 45000,
      maxContentLength: 8 * 1024 * 1024,
    });
    const contentType = bin.headers['content-type'] || 'application/octet-stream';
    const base64 = Buffer.from(bin.data).toString('base64');
    return { base64, contentType, url };
  } catch {
    return null;
  }
}

function pareceImagem(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const b = Buffer.from(bytes);
  if (b[0] === 0xff && b[1] === 0xd8) return true;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true;
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return true;
  return false;
}

function pareceVideo(bytes) {
  if (!bytes || bytes.length < 12) return false;
  const b = Buffer.from(bytes);
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true;
  return false;
}

async function downloadUrlAsBase64(url, opts = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const expect = opts.expectType || 'image';
  try {
    const bin = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 45000,
      maxContentLength: 8 * 1024 * 1024,
      maxRedirects: 5,
    });
    const contentType = bin.headers['content-type'] || 'application/octet-stream';
    const data = bin.data;
    const isImg =
      String(contentType).startsWith('image/') || pareceImagem(data);
    const isVid =
      String(contentType).startsWith('video/') || pareceVideo(data);
    if (expect === 'image' && !isImg) return null;
    if (expect === 'video' && !isVid) return null;
    return {
      base64: Buffer.from(data).toString('base64'),
      contentType: isVid
        ? contentType.startsWith('video/')
          ? contentType
          : 'video/mp4'
        : contentType.startsWith('image/')
          ? contentType
          : 'image/png',
      url,
    };
  } catch {
    return null;
  }
}

async function downloadEvidenceFile(arquivo) {
  if (!arquivo) return null;
  const tipo = arquivo.type === 'video' ? 'video' : 'image';
  const urls = [
    arquivo.urlPreview,
    arquivo.urlShow,
    arquivo.url,
  ].filter((u) => u && /^https?:\/\//i.test(u));

  if (arquivo.id) {
    const fromDisk = await downloadDiskFile(arquivo.id);
    if (fromDisk?.base64) return fromDisk;
  }

  for (const u of urls) {
    const data = await downloadUrlAsBase64(u, { expectType: tipo });
    if (data?.base64) return data;
  }
  return null;
}

/**
 * Textos dos comentários da timeline CRM (história / contexto da tarefa).
 * @param {number} entityTypeId
 * @param {number} itemId
 * @param {number} [maxComments]
 */
async function fetchTimelineCommentTexts(entityTypeId, itemId, maxComments = 12) {
  if (!BASE_URL) return '';
  const et = Number(entityTypeId);
  const id = Number(itemId);
  if (!Number.isFinite(et) || !Number.isFinite(id)) return '';

  const entityTypes = [
    `dynamic_${et}`,
    `CRM_DYNAMIC_${et}`,
    `DYNAMIC_${et}`,
  ];
  const partes = [];
  const seen = new Set();

  for (const entityType of entityTypes) {
    try {
      const res = await axios.post(
        `${BASE_URL}/crm.timeline.comment.list`,
        {
          filter: { ENTITY_ID: id, ENTITY_TYPE: entityType },
          order: { ID: 'DESC' },
          select: ['ID', 'COMMENT', 'CREATED'],
        },
        { validateStatus: (s) => s >= 200 && s < 500, timeout: 20000 }
      );
      if (restErrorMessage(res.data)) continue;
      for (const row of res.data?.result || []) {
        const txt = String(row.COMMENT || row.comment || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!txt || txt.length < 8 || seen.has(txt)) continue;
        seen.add(txt);
        partes.push(txt);
        if (partes.length >= maxComments) break;
      }
      if (partes.length) break;
    } catch {
      /* próximo entityType */
    }
  }

  return partes.join('\n\n');
}

module.exports = {
  listEvidenceFromCrmItem,
  downloadDiskFile,
  downloadUrlAsBase64,
  downloadEvidenceFile,
  fetchTimelineCommentTexts,
  classificarArquivo,
  extrairMidiaDeHtml,
};
