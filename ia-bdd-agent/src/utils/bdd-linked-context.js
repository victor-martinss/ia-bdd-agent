const {
  flattenItem,
  isMeaningful,
  extractTaskContext,
} = require('../agents/parser');
const { getTaskDetail } = require('../services/bitrix.service');
const {
  parentIdFromItem,
  listChildCrmItemIds,
} = require('../services/crm-item-links');
const { pickCrmUfText } = require('./crm-field-resolver');
const { extractCrmUrlRefsFromFlat } = require('./crm-item-ref');
const { limparTexto } = require('./bdd-gherkin');

function mergeTextoBlock(atual, novo, rotulo) {
  const a = limparTexto(atual);
  const n = limparTexto(novo);
  if (!n) return a;
  if (!a) return n;
  if (a.includes(n.slice(0, Math.min(80, n.length)))) return a;
  const tag = rotulo ? `--- ${rotulo} ---` : '--- card vinculado ---';
  return `${a}\n\n${tag}\n${n}`;
}

function entityTypeProbeList(currentEtId) {
  const fromEnv = String(process.env.BITRIX_ENTITY_TYPE_IDS || '')
    .split(/[,;\s]+/)
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const urlEt = Number.parseInt(String(process.env.BITRIX_ENTITY_TYPE_ID || ''), 10);
  const base = [
    currentEtId,
    ...fromEnv,
    Number.isFinite(urlEt) && urlEt > 0 ? urlEt : null,
    1272,
    1276,
    1294,
  ].filter((n) => Number.isFinite(n) && n > 0);
  return base.filter((n, i, arr) => arr.indexOf(n) === i);
}

/**
 * @param {Record<string, unknown>} lflat
 * @param {object} acc
 */
function mergeLinkedFields(acc, lflat) {
  const lctx = extractTaskContext(lflat);

  if (isMeaningful(lctx.cenariosTesteDev)) {
    acc.cenariosTesteDev = mergeTextoBlock(
      acc.cenariosTesteDev,
      lctx.cenariosTesteDev,
      'Dev (card vinculado)'
    );
  }
  if (!limparTexto(acc.descricao) && isMeaningful(lctx.descricao)) {
    acc.descricao = lctx.descricao;
  }
  if (!limparTexto(acc.passos) && isMeaningful(lctx.passos)) {
    acc.passos = lctx.passos;
  }
  if (!limparTexto(acc.resultadoEsperado) && isMeaningful(lctx.resultadoEsperado)) {
    acc.resultadoEsperado = lctx.resultadoEsperado;
  }
  if (!limparTexto(acc.resultadoObtido) && isMeaningful(lctx.resultadoObtido)) {
    acc.resultadoObtido = lctx.resultadoObtido;
  }
  if (!limparTexto(acc.observacoes) && isMeaningful(lctx.observacoes)) {
    acc.observacoes = lctx.observacoes;
  }
  if (!limparTexto(acc.comentariosTarefa) && isMeaningful(lctx.comentariosTarefa)) {
    acc.comentariosTarefa = lctx.comentariosTarefa;
  }

  const legacy = pickCrmUfText(lflat, ['DescricaoDoOcorrido']);
  if (!limparTexto(acc.descricao) && isMeaningful(legacy)) {
    acc.descricao = legacy;
  }
}

/**
 * Busca descrição, passos, cenários Dev e fontes de evidência em cards pai/vínculo (incl. URLs CRM em UFs).
 * @param {object} ctx
 * @param {object} rawItem
 */
async function enrichCtxFromLinkedCrm(ctx, rawItem) {
  if (process.env.BDD_ENRICH_FROM_LINKED_CRM === '0') return ctx;

  const flat = flattenItem(rawItem || {});
  const etId = Number.parseInt(
    String(flat._entityTypeId || flat.entityTypeId || ''),
    10
  );
  const itemId = Number.parseInt(String(flat.id || flat.ID || ''), 10);
  if (!Number.isFinite(etId) || !Number.isFinite(itemId)) return ctx;

  const entityProbe = entityTypeProbeList(etId);
  const visitados = new Set([`${etId}:${itemId}`]);
  /** @type {{ entityTypeId: number, itemId: number, priority: number }[]} */
  const fila = [];

  for (const ref of extractCrmUrlRefsFromFlat(flat)) {
    fila.push({ ...ref, priority: 0 });
  }

  const parentId = parentIdFromItem(flat, etId);
  if (parentId) fila.push({ entityTypeId: etId, itemId: parentId, priority: 1 });

  try {
    const filhos = await listChildCrmItemIds(itemId, etId);
    for (const cid of filhos) {
      fila.push({ entityTypeId: etId, itemId: cid, priority: 2 });
    }
  } catch {
    /* ignore */
  }

  const chamado =
    flat.ufCrm94NgfIdDoChamado ||
    flat.ufCrm100NgfIdDoChamado;
  if (chamado && String(chamado).trim() && String(chamado).trim() !== 'N/A') {
    const linkId = Number.parseInt(String(chamado).trim(), 10);
    if (Number.isFinite(linkId) && linkId > 0) {
      fila.push({ entityTypeId: 0, itemId: linkId, priority: 3 });
    }
  }

  fila.sort((a, b) => a.priority - b.priority);

  const acc = {
    cenariosTesteDev: ctx.cenariosTesteDev || '',
    descricao: ctx.descricao || '',
    passos: ctx.passos || '',
    resultadoEsperado: ctx.resultadoEsperado || '',
    resultadoObtido: ctx.resultadoObtido || '',
    observacoes: ctx.observacoes || '',
    comentariosTarefa: ctx.comentariosTarefa || '',
  };
  /** @type {{ rawItem: object, entityTypeId: number, itemId: number }[]} */
  const evidenceSources = [];

  for (const alvo of fila) {
    const key = alvo.entityTypeId
      ? `${alvo.entityTypeId}:${alvo.itemId}`
      : `?:${alvo.itemId}`;
    if (visitados.has(key)) continue;
    visitados.add(key);

    let linked = null;
    let resolvedEt = alvo.entityTypeId;

    if (alvo.entityTypeId > 0) {
      try {
        linked = await getTaskDetail(alvo.itemId, {
          entityTypeId: alvo.entityTypeId,
          noGlobalOverride: true,
        });
      } catch {
        /* tenta probe */
      }
    }

    if (!linked) {
      for (const probeEt of entityProbe) {
        if (probeEt === etId && alvo.itemId === itemId) continue;
        try {
          linked = await getTaskDetail(alvo.itemId, {
            entityTypeId: probeEt,
            noGlobalOverride: true,
          });
          if (linked) {
            resolvedEt = probeEt;
            break;
          }
        } catch {
          /* próximo SPA */
        }
      }
    }

    if (!linked) continue;

    const lflat = flattenItem(linked);
    const resolvedId = Number.parseInt(String(lflat.id || lflat.ID || alvo.itemId), 10);
    const resolvedKey = `${resolvedEt}:${resolvedId}`;
    if (visitados.has(resolvedKey) && resolvedKey !== key) continue;
    visitados.add(resolvedKey);

    mergeLinkedFields(acc, lflat);
    evidenceSources.push({
      rawItem: linked,
      entityTypeId: resolvedEt,
      itemId: resolvedId,
    });

    if (
      limparTexto(acc.cenariosTesteDev) &&
      limparTexto(acc.descricao) &&
      limparTexto(acc.passos)
    ) {
      break;
    }
  }

  const enriched =
    acc.cenariosTesteDev !== (ctx.cenariosTesteDev || '') ||
    acc.descricao !== (ctx.descricao || '') ||
    acc.passos !== (ctx.passos || '') ||
    acc.resultadoEsperado !== (ctx.resultadoEsperado || '') ||
    acc.resultadoObtido !== (ctx.resultadoObtido || '');

  if (!enriched && !evidenceSources.length) return ctx;

  return {
    ...ctx,
    ...acc,
    _fontesVinculo: enriched || evidenceSources.length ? 'card_vinculado' : ctx._fontesVinculo,
    _linkedCrmEvidenceSources: evidenceSources,
  };
}

module.exports = { enrichCtxFromLinkedCrm, mergeTextoBlock, entityTypeProbeList };
