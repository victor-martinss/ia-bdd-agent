const { flattenItem, textoCenariosTesteDevFromItem, isMeaningful, texto } = require('../agents/parser');
const { getTaskDetail } = require('../services/bitrix.service');
const {
  parentIdFromItem,
  listChildCrmItemIds,
} = require('../services/crm-item-links');
const { limparTexto } = require('./bdd-gherkin');

function mergeDevTexto(atual, novo) {
  const a = limparTexto(atual);
  const n = limparTexto(novo);
  if (!n) return a;
  if (!a) return n;
  if (a.includes(n.slice(0, Math.min(80, n.length)))) return a;
  return `${a}\n\n--- Dev (card vinculado) ---\n${n}`;
}

/**
 * Busca Cenários de Teste (Dev) em cards pai/filho/vínculo no mesmo SPA.
 * @param {object} ctx
 * @param {object} rawItem
 */
async function enrichCtxFromLinkedCrm(ctx, rawItem) {
  if (process.env.BDD_ENRICH_FROM_LINKED_CRM === '0') return ctx;
  if (limparTexto(ctx.cenariosTesteDev)) return ctx;

  const flat = flattenItem(rawItem || {});
  const etId = Number.parseInt(
    String(flat._entityTypeId || flat.entityTypeId || ''),
    10
  );
  const itemId = Number.parseInt(String(flat.id || flat.ID || ''), 10);
  if (!Number.isFinite(etId) || !Number.isFinite(itemId)) return ctx;

  const entityProbe = [
    etId,
    ...String(process.env.BITRIX_ENTITY_TYPE_IDS || '')
      .split(/[,;\s]+/)
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0),
    1276,
    1294,
  ].filter((n, i, arr) => arr.indexOf(n) === i);

  const visitados = new Set([itemId]);
  const candidatos = [];

  const parentId = parentIdFromItem(flat, etId);
  if (parentId) candidatos.push(parentId);

  try {
    const filhos = await listChildCrmItemIds(itemId, etId);
    candidatos.push(...filhos);
  } catch {
    /* ignore */
  }

  const chamado =
    flat.ufCrm94NgfIdDoChamado ||
    flat.ufCrm100NgfIdDoChamado ||
    flat.ufCrm94NgfIdExterno ||
    flat.ufCrm100NgfIdExterno;
  if (chamado && String(chamado).trim() && String(chamado).trim() !== 'N/A') {
    const linkId = Number.parseInt(String(chamado).trim(), 10);
    if (Number.isFinite(linkId) && linkId > 0) candidatos.push(linkId);
  }

  let dev = '';
  let descricao = ctx.descricao || '';
  let passos = ctx.passos || '';

  for (const cid of candidatos) {
    if (!cid || visitados.has(cid)) continue;
    visitados.add(cid);
    try {
      let linked = null;
      for (const probeEt of entityProbe) {
        try {
          linked = await getTaskDetail(cid, {
            entityTypeId: probeEt,
            noGlobalOverride: true,
          });
          if (linked) break;
        } catch {
          /* tenta outro SPA */
        }
      }
      if (!linked) continue;
      const lflat = flattenItem(linked);
      const devLinked = textoCenariosTesteDevFromItem(lflat);
      if (isMeaningful(devLinked)) {
        dev = mergeDevTexto(dev, devLinked);
      }
      if (!limparTexto(descricao)) {
        const { pickCrmUfText } = require('./crm-field-resolver');
        const d = pickCrmUfText(lflat, ['NgfDescricaoDoOcorrido', 'DescricaoDoOcorrido']);
        if (isMeaningful(d)) descricao = d;
      }
      if (!limparTexto(passos)) {
        const { pickCrmUfText } = require('./crm-field-resolver');
        const p = pickCrmUfText(lflat, ['NgfPassosParaReproduzir', 'PassosParaReproduzir']);
        if (isMeaningful(p)) passos = p;
      }
      if (limparTexto(dev)) break;
    } catch {
      /* próximo vínculo */
    }
  }

  if (!dev && !descricao && !passos) return ctx;

  return {
    ...ctx,
    cenariosTesteDev: dev || ctx.cenariosTesteDev,
    descricao: descricao || ctx.descricao,
    passos: passos || ctx.passos,
    _fontesVinculo: dev ? 'card_vinculado' : '',
  };
}

module.exports = { enrichCtxFromLinkedCrm };
