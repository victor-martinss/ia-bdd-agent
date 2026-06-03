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

  const evidence = await analyzeDevEvidence(flat, base, meta);
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

  return base;
}

module.exports = {
  assertiveModeEnabled,
  prepareCtxSync,
  enrichCtxWithEvidence,
  aplicarFiltroContexto,
};
