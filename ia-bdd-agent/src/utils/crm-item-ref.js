/**
 * Referências a cards CRM em URLs Bitrix (ex.: ufCrm100_* com link para card pai).
 */

/**
 * @param {string} text
 * @returns {{ entityTypeId: number, itemId: number }[]}
 */
function parseBitrixCrmUrlRefs(text) {
  const refs = [];
  const seen = new Set();
  const re = /crm\/type\/(\d+)\/details\/(\d+)/gi;
  let m;
  const blob = String(text || '');
  while ((m = re.exec(blob))) {
    const entityTypeId = Number.parseInt(m[1], 10);
    const itemId = Number.parseInt(m[2], 10);
    if (!Number.isFinite(entityTypeId) || !Number.isFinite(itemId)) continue;
    const key = `${entityTypeId}:${itemId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ entityTypeId, itemId });
  }
  return refs;
}

/**
 * @param {Record<string, unknown>} flat
 * @returns {{ entityTypeId: number, itemId: number }[]}
 */
function extractCrmUrlRefsFromFlat(flat) {
  if (!flat || typeof flat !== 'object') return [];
  const all = [];
  const seen = new Set();
  for (const v of Object.values(flat)) {
    if (v == null || v === '') continue;
    const text = Array.isArray(v) ? v.map(String).join('\n') : String(v);
    for (const ref of parseBitrixCrmUrlRefs(text)) {
      const key = `${ref.entityTypeId}:${ref.itemId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(ref);
    }
  }
  return all;
}

module.exports = {
  parseBitrixCrmUrlRefs,
  extractCrmUrlRefsFromFlat,
};
