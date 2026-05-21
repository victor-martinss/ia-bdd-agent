require('../../load-env');
const {
  listEvidenceFromCrmItem,
  downloadDiskFile,
  downloadUrlAsBase64,
} = require('./bitrix-evidence.service');
const { runOpenAIWithMessages, isVisionCapable } = require('./ia.service');

function evidenceAnalysisEnabled() {
  return process.env.BDD_ANALYZE_EVIDENCE !== '0';
}

function maxImagesToAnalyze() {
  const n = Number.parseInt(process.env.BDD_EVIDENCE_MAX_IMAGES || '4', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8) : 4;
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

  if (videos.length) {
    partesResumo.push(
      `Vídeos (${videos.length}): ${videos.map((v) => v.name).join(', ')} — reproduzir manualmente e validar comportamento descrito no chamado`
    );
  }

  let analyzed = 0;
  const imagePayloads = [];

  for (const img of images) {
    if (analyzed >= maxImagesToAnalyze()) break;
    let data = null;
    if (img.id) data = await downloadDiskFile(img.id);
    if (!data && img.url) data = await downloadUrlAsBase64(img.url);
    if (data && data.base64) {
      imagePayloads.push({ name: img.name, ...data });
      analyzed += 1;
    }
  }

  let defeitoVisivel = null;

  if (imagePayloads.length && isVisionCapable()) {
    try {
      const vision = await runVisionAnalysis(ctx, imagePayloads);
      if (vision.resumo) partesResumo.push(vision.resumo);
      if (vision.validacoes?.length) validacoes.push(...vision.validacoes);
      if (vision.passosObservados?.length) {
        partesResumo.push(`Passos visíveis nas evidências: ${vision.passosObservados.join('; ')}`);
      }
      if (vision.defeitoVisivel) defeitoVisivel = vision.defeitoVisivel;
    } catch (e) {
      partesResumo.push(`Análise visual indisponível: ${e.message || e}`);
    }
  } else if (images.length && !isVisionCapable()) {
    partesResumo.push(
      'Imagens anexadas — configure OPENAI_API_KEY e BDD_VISION_MODEL (ex.: gpt-4o) para análise automática'
    );
  }

  return {
    resumo: partesResumo.join('\n'),
    validacoes,
    arquivos,
    imageCount: images.length,
    videoCount: videos.length,
    analyzedImages: analyzed,
    defeitoVisivel,
  };
}

async function runVisionAnalysis(ctx, imagePayloads) {
  const contexto = [
    `Título: ${ctx.titulo || ''}`,
    ctx.descricao ? `Descrição: ${ctx.descricao}` : '',
    ctx.passos ? `Passos: ${ctx.passos}` : '',
    ctx.resultadoEsperado ? `Resultado esperado: ${ctx.resultadoEsperado}` : '',
    ctx.resultadoObtido ? `Resultado obtido: ${ctx.resultadoObtido}` : '',
    ctx.cenariosTesteDev ? `Cenários Dev:\n${ctx.cenariosTesteDev}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const userContent = [
    {
      type: 'text',
      text:
        'Analise as evidências (prints/vídeos) anexadas pelo Dev neste chamado Mobilemed.\n' +
        'Responda APENAS JSON válido:\n' +
        '{\n' +
        '  "resumo": "o que as imagens mostram em 2-4 frases",\n' +
        '  "passosObservados": ["passo 1", "passo 2"],\n' +
        '  "validacoes": ["critério verificável 1", "critério 2"],\n' +
        '  "defeitoVisivel": "comportamento errado visto ou null",\n' +
        '  "elementosTela": ["botão X", "campo Y", "mensagem Z"]\n' +
        '}\n\n' +
        `Contexto do chamado:\n${contexto}`,
    },
  ];

  for (const img of imagePayloads) {
    userContent.push({
      type: 'image_url',
      image_url: {
        url: `data:${img.contentType};base64,${img.base64}`,
        detail: 'high',
      },
    });
  }

  const raw = await runOpenAIWithMessages(
    [
      {
        role: 'system',
        content:
          'Você é QA Mobilemed. Analisa evidências visuais de bugs e extrai passos e validações objetivas para testes BDD. Responda só JSON.',
      },
      { role: 'user', content: userContent },
    ],
    { vision: true }
  );

  try {
    const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return {
      resumo: json.resumo || '',
      validacoes: Array.isArray(json.validacoes) ? json.validacoes : [],
      passosObservados: Array.isArray(json.passosObservados) ? json.passosObservados : [],
      defeitoVisivel: json.defeitoVisivel || null,
      elementosTela: json.elementosTela || [],
    };
  } catch {
    return { resumo: raw.slice(0, 800), validacoes: [], passosObservados: [] };
  }
}

module.exports = {
  evidenceAnalysisEnabled,
  analyzeDevEvidence,
};
