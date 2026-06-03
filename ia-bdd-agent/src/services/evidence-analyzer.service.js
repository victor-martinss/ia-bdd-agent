require('../../load-env');
const {
  listEvidenceFromCrmItem,
  downloadDiskFile,
  downloadUrlAsBase64,
} = require('./bitrix-evidence.service');
const {
  runVisionEvidenceAnalysis,
  isVisionCapable,
  resolveVisionProvider,
  visionProviderLabel,
} = require('./ia.service');

function evidenceAnalysisEnabled() {
  return process.env.BDD_ANALYZE_EVIDENCE !== '0';
}

function maxImagesToAnalyze() {
  const n = Number.parseInt(process.env.BDD_EVIDENCE_MAX_IMAGES || '4', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 8) : 4;
}

function maxVideosToAnalyze() {
  if (process.env.BDD_GEMINI_ANALYZE_VIDEO === '0') return 0;
  if (resolveVisionProvider() !== 'gemini') return 0;
  const n = Number.parseInt(process.env.BDD_EVIDENCE_MAX_VIDEOS || '1', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 2) : 1;
}

function maxVideoBytes() {
  const n = Number.parseInt(process.env.BDD_EVIDENCE_MAX_VIDEO_BYTES || '15728640', 10);
  return Number.isFinite(n) && n > 0 ? n : 15728640;
}

function visionSetupHint() {
  const vp = resolveVisionProvider();
  if (vp === 'gemini') {
    return 'configure GEMINI_API_KEY e BDD_VISION_PROVIDER=gemini';
  }
  return 'configure OPENAI_API_KEY e BDD_VISION_PROVIDER=openai (ou BDD_VISION_MODEL=gpt-4o)';
}

/**
 * Analisa evidências (imagens/vídeos) com IA visão quando disponível.
 * @param {object} item
 * @param {object} ctx
 * @param {{ entityTypeId?: number, itemId?: number }} meta
 */
async function analyzeDevEvidence(item, ctx, meta = {}) {
  if (!evidenceAnalysisEnabled()) {
    return { resumo: '', validacoes: [], arquivos: [], skipped: true };
  }

  const arquivos = await listEvidenceFromCrmItem(item, meta);
  const validacoes = [];
  const partesResumo = [];

  if (!arquivos.length) {
    return {
      resumo: '',
      validacoes: [],
      arquivos: [],
      skipped: false,
      message: 'nenhuma evidência de mídia encontrada no card',
    };
  }

  partesResumo.push(
    `Evidências encontradas: ${arquivos.length} arquivo(s) (${arquivos.map((a) => a.name).slice(0, 5).join(', ')})`
  );

  const images = arquivos.filter((a) => a.type === 'image');
  const videos = arquivos.filter((a) => a.type === 'video');

  let analyzedImages = 0;
  let analyzedVideos = 0;
  const mediaPayloads = [];

  for (const img of images) {
    if (analyzedImages >= maxImagesToAnalyze()) break;
    let data = null;
    if (img.id) data = await downloadDiskFile(img.id);
    if (!data && img.url) data = await downloadUrlAsBase64(img.url);
    if (data && data.base64) {
      mediaPayloads.push({ name: img.name, ...data });
      analyzedImages += 1;
    }
  }

  const maxVid = maxVideosToAnalyze();
  if (maxVid > 0) {
    for (const vid of videos) {
      if (analyzedVideos >= maxVid) break;
      let data = null;
      if (vid.id) data = await downloadDiskFile(vid.id);
      if (!data && vid.url) data = await downloadUrlAsBase64(vid.url);
      if (!data?.base64) continue;
      const sizeBytes = Math.ceil((data.base64.length * 3) / 4);
      if (sizeBytes > maxVideoBytes()) {
        partesResumo.push(
          `Vídeo ${vid.name} omitido (${Math.round(sizeBytes / 1048576)}MB > limite ${Math.round(maxVideoBytes() / 1048576)}MB)`
        );
        continue;
      }
      mediaPayloads.push({
        name: vid.name,
        base64: data.base64,
        contentType: data.contentType || 'video/mp4',
      });
      analyzedVideos += 1;
    }
  }

  if (videos.length && analyzedVideos === 0 && maxVid === 0) {
    partesResumo.push(
      `Vídeos (${videos.length}): ${videos.map((v) => v.name).join(', ')} — ative BDD_GEMINI_ANALYZE_VIDEO=1 com BDD_VISION_PROVIDER=gemini para análise automática`
    );
  }

  let defeitoVisivel = null;
  let passosObservados = [];
  let elementosTela = [];
  let visionProvider = visionProviderLabel();

  if (mediaPayloads.length && isVisionCapable()) {
    try {
      const vision = await runVisionEvidenceAnalysis(ctx, mediaPayloads);
      visionProvider = vision._provider || visionProvider;
      if (vision.resumo) partesResumo.push(vision.resumo);
      if (vision.validacoes?.length) validacoes.push(...vision.validacoes);
      if (vision.passosObservados?.length) {
        passosObservados = vision.passosObservados;
        partesResumo.push(`Passos visíveis: ${passosObservados.slice(0, 5).join('; ')}`);
      }
      if (vision.elementosTela?.length) {
        elementosTela = vision.elementosTela;
        partesResumo.push(`Elementos na tela: ${elementosTela.slice(0, 8).join(', ')}`);
      }
      if (vision.defeitoVisivel) defeitoVisivel = vision.defeitoVisivel;
      partesResumo.push(
        `Análise visual (${visionProvider}): ${analyzedImages} imagem(ns)${analyzedVideos ? `, ${analyzedVideos} vídeo(s)` : ''}`
      );
    } catch (e) {
      partesResumo.push(`Análise visual indisponível (${visionProvider}): ${e.message || e}`);
    }
  } else if ((images.length || videos.length) && !isVisionCapable()) {
    partesResumo.push(`Imagens/vídeos anexados — ${visionSetupHint()}`);
  }

  return {
    resumo: partesResumo.join('\n'),
    validacoes,
    arquivos,
    imageCount: images.length,
    videoCount: videos.length,
    analyzedImages,
    analyzedVideos,
    visionProvider,
    defeitoVisivel,
    passosObservados,
    elementosTela,
  };
}

module.exports = {
  evidenceAnalysisEnabled,
  analyzeDevEvidence,
};
