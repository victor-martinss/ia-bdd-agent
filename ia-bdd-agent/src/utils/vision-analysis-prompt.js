const VISION_SYSTEM =
  'Você é QA Mobilemed. Analisa evidências visuais de bugs e extrai passos e validações objetivas para testes BDD. Responda só JSON válido.';

function buildVisionContext(ctx) {
  return [
    `Título: ${ctx.titulo || ''}`,
    ctx.descricao ? `Descrição: ${ctx.descricao}` : '',
    ctx.passos ? `Passos: ${ctx.passos}` : '',
    ctx.resultadoEsperado ? `Resultado esperado: ${ctx.resultadoEsperado}` : '',
    ctx.resultadoObtido ? `Resultado obtido: ${ctx.resultadoObtido}` : '',
    ctx.cenariosTesteDev ? `Cenários Dev:\n${ctx.cenariosTesteDev}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildVisionUserPrompt(ctx) {
  return (
    'Analise as evidências (prints/vídeos) anexadas pelo Dev neste chamado Mobilemed.\n' +
    'Responda APENAS JSON válido:\n' +
    '{\n' +
    '  "resumo": "o que as imagens mostram em 2-4 frases",\n' +
    '  "passosObservados": ["passo 1", "passo 2"],\n' +
    '  "validacoes": ["critério verificável 1", "critério 2"],\n' +
    '  "defeitoVisivel": "comportamento errado visto ou null",\n' +
    '  "elementosTela": ["botão X", "campo Y", "mensagem Z"]\n' +
    '}\n\n' +
    `Contexto do chamado:\n${buildVisionContext(ctx)}`
  );
}

function parseVisionJson(raw) {
  try {
    const json = JSON.parse(String(raw).replace(/```json|```/g, '').trim());
    return {
      resumo: json.resumo || '',
      validacoes: Array.isArray(json.validacoes) ? json.validacoes : [],
      passosObservados: Array.isArray(json.passosObservados) ? json.passosObservados : [],
      defeitoVisivel: json.defeitoVisivel || null,
      elementosTela: Array.isArray(json.elementosTela) ? json.elementosTela : [],
    };
  } catch {
    return {
      resumo: String(raw || '').slice(0, 800),
      validacoes: [],
      passosObservados: [],
      defeitoVisivel: null,
      elementosTela: [],
    };
  }
}

module.exports = {
  VISION_SYSTEM,
  buildVisionUserPrompt,
  parseVisionJson,
};
