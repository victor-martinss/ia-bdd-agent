const { detectAmbiente, onlyTitleAndDevSources } = require('./bdd-ambiente');
const { analyzeDevEvidence, evidenceAnalysisEnabled } = require('../services/evidence-analyzer.service');
const { flattenItem } = require('../agents/parser');
const { aplicarFiltroContexto } = require('./bdd-context-filter');

/** Modo assertivo: descrição, passos, resultados + evidências (padrão ligado). */
function assertiveModeEnabled() {
  return process.env.BDD_ASSERTIVE_MODE !== '0';
}

/**
 * @param {ReturnType<typeof import('../agents/parser').extractTaskContext>} fullCtx
 * @param {string} title
 */
function prepareCtxSync(fullCtx, title) {
  const titulo = fullCtx.titulo || title || '';
  const cenariosTesteDev = fullCtx.cenariosTesteDev || '';
  const ambiente = detectAmbiente(titulo, cenariosTesteDev);

  if (onlyTitleAndDevSources() && !assertiveModeEnabled()) {
    return {
      titulo,
      cenariosTesteDev,
      ambiente,
      _fontes: 'title_dev_only',
      descricao: '',
      passos: '',
      resultadoEsperado: '',
      resultadoObtido: '',
      evidenceResumo: '',
      evidenceValidacoes: [],
    };
  }

  if (!assertiveModeEnabled()) {
    return { ...fullCtx, ambiente, _fontes: 'full' };
  }

  return {
    ...fullCtx,
    titulo,
    cenariosTesteDev,
    ambiente,
    _fontes: 'assertive',
    descricao: fullCtx.descricao || '',
    passos: fullCtx.passos || '',
    resultadoEsperado: fullCtx.resultadoEsperado || '',
    resultadoObtido: fullCtx.resultadoObtido || '',
    observacoes: fullCtx.observacoes || '',
    evidenceResumo: '',
    evidenceValidacoes: [],
    solucaoEsperada: fullCtx.resultadoEsperado || '',
  };
}

/**
 * Enriquece contexto com análise de evidências Dev (imagens/vídeos).
 * @param {object} ctx
 * @param {object} rawItem
 * @param {string} title
 */
function mergeEvidenceResults(primary, extra, sourceLabel) {
  if (!extra?.arquivos?.length) return primary;
  const merged = { ...primary };
  merged.arquivos = [...(primary.arquivos || []), ...(extra.arquivos || [])];
  merged.imageCount = (primary.imageCount || 0) + (extra.imageCount || 0);
  merged.videoCount = (primary.videoCount || 0) + (extra.videoCount || 0);
  merged.analyzedImages = (primary.analyzedImages || 0) + (extra.analyzedImages || 0);
  merged.analyzedVideos = (primary.analyzedVideos || 0) + (extra.analyzedVideos || 0);
  merged.resumo = [primary.resumo, extra.resumo, sourceLabel ? `(evidências: ${sourceLabel})` : '']
    .filter(Boolean)
    .join('\n');
  merged.validacoes = [...(primary.validacoes || []), ...(extra.validacoes || [])];
  if (!merged.defeitoVisivel && extra.defeitoVisivel) {
    merged.defeitoVisivel = extra.defeitoVisivel;
  }
  if (!merged.passosObservados?.length && extra.passosObservados?.length) {
    merged.passosObservados = extra.passosObservados;
  }
  if (!merged.elementosTela?.length && extra.elementosTela?.length) {
    merged.elementosTela = extra.elementosTela;
  }
  if (extra.visionProvider) merged.visionProvider = extra.visionProvider;
  return merged;
}

async function enrichCtxWithEvidence(ctx, rawItem, title) {
  const base = prepareCtxSync(ctx, title);
  if (!assertiveModeEnabled() || !evidenceAnalysisEnabled()) {
    return base;
  }

  const flat = flattenItem(rawItem || {});
  const meta = {
    entityTypeId: flat._entityTypeId || flat.entityTypeId,
    itemId: flat.id || flat.ID,
  };

  let evidence = await analyzeDevEvidence(flat, base, meta);

  const linkedSources = ctx._linkedCrmEvidenceSources || [];
  const cardSemMidia = !(evidence.arquivos?.length > 0);
  if (cardSemMidia && linkedSources.length && process.env.BDD_EVIDENCE_FROM_LINKED !== '0') {
    for (const src of linkedSources) {
      const sub = await analyzeDevEvidence(src.rawItem, base, {
        entityTypeId: src.entityTypeId,
        itemId: src.itemId,
      });
      if (!sub.arquivos?.length) continue;
      evidence = mergeEvidenceResults(
        evidence,
        sub,
        `card ${src.itemId} (SPA ${src.entityTypeId})`
      );
      if (sub.analyzedImages > 0 || sub.analyzedVideos > 0) break;
    }
  }

  base.evidenceResumo = evidence.resumo || '';
  base.evidenceValidacoes = evidence.validacoes || [];
  base.evidenceMeta = {
    arquivos: evidence.arquivos?.length || 0,
    imagens: evidence.imageCount || 0,
    videos: evidence.videoCount || 0,
    analisadas: evidence.analyzedImages || 0,
    videosAnalisados: evidence.analyzedVideos || 0,
    visionProvider: evidence.visionProvider || '',
  };

  if (evidence.defeitoVisivel) {
    base.defeitoNasEvidencias = evidence.defeitoVisivel;
    if (!base.resultadoObtido) {
      base.resultadoObtido = evidence.defeitoVisivel;
    }
  }

  if (evidence.passosObservados?.length) {
    base.passosEvidencia = evidence.passosObservados;
  }
  if (evidence.elementosTela?.length) {
    base.elementosTelaEvidencia = evidence.elementosTela;
  }

  if (ctx._fontesVinculo) base._fontesVinculo = ctx._fontesVinculo;

  return base;
}

module.exports = {
  assertiveModeEnabled,
  prepareCtxSync,
  enrichCtxWithEvidence,
  aplicarFiltroContexto,
};
