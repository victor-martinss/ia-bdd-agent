/**
 * Mapeia entityTypeId do SPA → prefixo UF (ufCrm94 NGF, ufCrm100 DICOM, etc.).
 */

function parseEntityUfPrefixMap() {
  const raw = (process.env.BITRIX_ENTITY_UF_PREFIX_MAP || '').trim();
  const map = new Map();
  if (!raw) return map;
  for (const part of raw.split(/[,;]+/)) {
    const [et, pref] = part.split(':').map((s) => s.trim());
    const n = Number.parseInt(et, 10);
    if (Number.isFinite(n) && n > 0 && pref) {
      map.set(n, pref.toLowerCase());
    }
  }
  return map;
}

/**
 * @param {number} entityTypeId
 * @returns {string | null} ex.: ufCrm94
 */
function ufPrefixForEntityTypeId(entityTypeId) {
  const n = Number.parseInt(String(entityTypeId), 10);
  if (!Number.isFinite(n) || n <= 0) return null;

  const map = parseEntityUfPrefixMap();
  if (map.has(n)) return map.get(n);

  if (n === 1276) return 'ufcrm94';
  if (n === 1294) return 'ufcrm100';
  return null;
}

/**
 * Filtra chaves UF para o SPA do card (evita ufCrm94 em entity 1294).
 * @param {string[]} keys
 * @param {number | undefined | null} entityTypeId
 * @returns {string[]}
 */
function filterFieldKeysForEntityType(keys, entityTypeId) {
  const prefix = ufPrefixForEntityTypeId(entityTypeId);
  if (!prefix || !keys.length) return keys;
  const filtered = keys.filter((k) =>
    String(k).toLowerCase().startsWith(prefix)
  );
  return filtered.length ? filtered : keys;
}

module.exports = {
  ufPrefixForEntityTypeId,
  filterFieldKeysForEntityType,
};
