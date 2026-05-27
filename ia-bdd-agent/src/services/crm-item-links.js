require('../../load-env');
const axios = require('axios');

const BASE_URL = process.env.BITRIX_WEBHOOK;

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

/**
 * @param {Record<string, unknown>} flat
 * @param {number} entityTypeId
 */
function parentIdFromItem(flat, entityTypeId) {
  if (!flat) return null;
  const keys = [
    `parentId${entityTypeId}`,
    'parentId',
    `PARENT_ID_${entityTypeId}`,
  ];
  for (const k of keys) {
    const v = flat[k];
    const n = Number.parseInt(String(v), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * IDs de itens CRM filhos (parentId).
 */
async function listChildCrmItemIds(parentItemId, entityTypeId) {
  if (!BASE_URL) return [];
  const parentKey = `parentId${entityTypeId}`;
  const filters = [
    { [parentKey]: parentItemId },
    { [`=${parentKey}`]: parentItemId },
    { parentId: parentItemId },
  ];
  const ids = new Set();
  const url = `${BASE_URL}/crm.item.list`;

  for (const filter of filters) {
    let start = 0;
    for (;;) {
      try {
        const response = await axios.post(
          url,
          { entityTypeId, filter, start, limit: 50 },
          { headers: { 'Content-Type': 'application/json' } }
        );
        if (restErrorMessage(response.data)) break;
        const items = (response.data.result && response.data.result.items) || [];
        for (const it of items) {
          const id = Number(it.id ?? it.ID);
          if (Number.isFinite(id) && id !== Number(parentItemId)) ids.add(id);
        }
        if (items.length < 50) break;
        start += 50;
      } catch {
        break;
      }
    }
    if (ids.size) break;
  }
  return [...ids];
}

module.exports = {
  parentIdFromItem,
  listChildCrmItemIds,
};
