/**
 * Mostra no terminal: SPA (crm.type.list), categorias e estágios/colunas
 * para você copiar entityTypeId, STAGE_ID ou montar BITRIX_LIST_FILTER_JSON.
 *
 * Uso: na pasta ia-bdd-agent com .env (BITRIX_WEBHOOK), ou na raiz do monorepo:
 *   npm run bitrix:context
 */
const path = require('path');
require(path.join(__dirname, '../load-env'));

const axios = require('axios');

const BASE = process.env.BITRIX_WEBHOOK;
if (!BASE) {
  console.error('Defina BITRIX_WEBHOOK no .env (ia-bdd-agent/.env).');
  process.exit(1);
}

function err(data) {
  if (!data || !data.error) return '';
  return String(data.error_description || data.error);
}

async function main() {
  console.log('--- crm.type.list (Smart Processes / SPA) ---\n');
  const tl = await axios.get(`${BASE}/crm.type.list`, {}).catch((e) => ({ data: {} }));
  if (err(tl.data)) {
    console.error('Erro:', err(tl.data));
    process.exit(1);
  }
  const tr = tl.data.result;
  const types = Array.isArray(tr) ? tr : (tr && (tr.types || tr.TYPES)) || [];
  for (const t of types) {
    const id = t.entityTypeId ?? t.ENTITY_TYPE_ID;
    const title = t.title || t.TITLE || '';
    const name = t.name || t.NAME || '';
    console.log(`entityTypeId=${id}  title="${title}"  name="${name}"`);
  }

  const focus =
    Number.parseInt(process.env.BITRIX_ENTITY_TYPE_ID || '', 10) ||
    null;
  const titleNeedle = (process.env.BITRIX_SMART_PROCESS_TITLE || '').trim();
  let etId = focus;
  if (!etId && titleNeedle) {
    const needle = titleNeedle.toLowerCase();
    for (const t of types) {
      const tit = String(t.title || t.TITLE || '').toLowerCase();
      const nam = String(t.name || t.NAME || '').toLowerCase();
      if (tit.includes(needle) || nam.includes(needle)) {
        etId = Number(t.entityTypeId ?? t.ENTITY_TYPE_ID);
        break;
      }
    }
  }
  if (!etId) etId = 1276;

  console.log(`\n--- crm.category.list (entityTypeId=${etId}) ---\n`);
  const cl = await axios
    .get(`${BASE}/crm.category.list`, { params: { entityTypeId: etId } })
    .catch((e) => ({ data: {} }));
  if (err(cl.data)) {
    console.error('Erro:', err(cl.data));
    return;
  }
  const cr = cl.data.result;
  const cats = (cr && (cr.categories || cr.CATEGORIES)) || [];
  for (const c of cats) {
    const id = c.id ?? c.ID;
    const name = c.name || c.NAME || '';
    const def = c.isDefault || c.IS_DEFAULT || '';
    console.log(`category id=${id}  name="${name}"  default=${def}`);
  }

  const catId =
    Number.parseInt(process.env.BITRIX_CATEGORY_ID || '', 10) ||
    (cats[0] && (cats[0].id ?? cats[0].ID)) ||
    0;
  const entityStatus = `DYNAMIC_${etId}_STAGE_${catId}`;
  console.log(`\n--- crm.status.list (colunas / ENTITY_ID=${entityStatus}) ---\n`);

  const sl = await axios
    .post(
      `${BASE}/crm.status.list`,
      { filter: { ENTITY_ID: entityStatus } },
      { headers: { 'Content-Type': 'application/json' } }
    )
    .catch(() => null);
  let statuses = [];
  if (sl && !err(sl.data)) {
    const sr = sl.data.result;
    statuses = Array.isArray(sr) ? sr : (sr && (sr.statuses || sr.STATUSES)) || [];
  }
  if (!statuses.length) {
    const sl2 = await axios
      .get(`${BASE}/crm.status.list`, {
        params: { filter: { ENTITY_ID: entityStatus } },
      })
      .catch(() => ({ data: {} }));
    if (!err(sl2.data)) {
      const sr = sl2.data.result;
      statuses = Array.isArray(sr) ? sr : (sr && (sr.statuses || sr.STATUSES)) || [];
    }
  }
  if (err(sl && sl.data)) console.error('crm.status.list:', err(sl.data));
  for (const s of statuses) {
    const sid = s.STATUS_ID || s.statusId;
    const name = s.NAME || s.name || '';
    console.log(`STAGE_ID=${sid}  NAME="${name}"`);
  }

  console.log('\n--- Sugestão .env (ajuste os valores) ---\n');
  console.log(`BITRIX_ENTITY_TYPE_ID=${etId}`);
  console.log(`BITRIX_CATEGORY_ID=${catId}`);
  console.log('# Coluna "Novo Teste" (nome exibido no Kanban):');
  console.log('BITRIX_STAGE_NAME=Novo Teste');
  console.log('# Ou SPA pelo título:');
  console.log('# BITRIX_SMART_PROCESS_TITLE=Desenvolvimento Q.A.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
