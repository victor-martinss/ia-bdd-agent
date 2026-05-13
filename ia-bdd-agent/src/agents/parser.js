function texto(valor) {
  if (valor == null || valor === '') return '';
  if (Array.isArray(valor)) return valor.map(texto).filter(Boolean).join(', ');
  return String(valor).trim();
}

/** Ignora placeholders comuns do formulário ("x", "xx", "-"). */
function isMeaningful(s) {
  const t = texto(s);
  if (t.length < 3) return false;
  if (/^x+$/i.test(t)) return false;
  if (/^[\-–—.]+$/i.test(t)) return false;
  if (/^n\/?a$/i.test(t)) return false;
  return true;
}

function flattenItem(item) {
  if (!item) return {};
  if (item.fields && typeof item.fields === 'object') {
    return { ...item, ...item.fields };
  }
  return item;
}

/**
 * Campos do CRM Bitrix (entity 1276 / NGF) usados para QA e BDD.
 */
function extractTaskContext(raw) {
  const item = flattenItem(raw);
  return {
    titulo:
      (isMeaningful(item.ufCrm94NgfTitulo) && texto(item.ufCrm94NgfTitulo)) ||
      (isMeaningful(item.title) && texto(item.title)) ||
      '',

    descricao: isMeaningful(item.ufCrm94NgfDescricaoDoOcorrido)
      ? texto(item.ufCrm94NgfDescricaoDoOcorrido)
      : '',

    passos: isMeaningful(item.ufCrm94NgfPassosParaReproduzir)
      ? texto(item.ufCrm94NgfPassosParaReproduzir)
      : '',

    resultadoEsperado: isMeaningful(item.ufCrm94NgfResultadoEsperado)
      ? texto(item.ufCrm94NgfResultadoEsperado)
      : '',

    resultadoObtido: isMeaningful(item.ufCrm94NgfResultadoObtido)
      ? texto(item.ufCrm94NgfResultadoObtido)
      : '',

    sugestaoMelhoria: isMeaningful(item.ufCrm94NgfSugestaoDeMelhoria)
      ? texto(item.ufCrm94NgfSugestaoDeMelhoria)
      : '',

    motivoMelhoria: isMeaningful(item.ufCrm94NgfMotivoDeMelhoria)
      ? texto(item.ufCrm94NgfMotivoDeMelhoria)
      : '',

    observacoes: isMeaningful(item.ufCrm94NgfObservacoes)
      ? texto(item.ufCrm94NgfObservacoes)
      : '',

    observacoesHu: isMeaningful(item.ufCrm94ObservacoesParaGeracaoHu)
      ? texto(item.ufCrm94ObservacoesParaGeracaoHu)
      : '',

    observacoesTriagem: isMeaningful(item.ufCrm94NgfObservacoesDaTriagemDeQualidade)
      ? texto(item.ufCrm94NgfObservacoesDaTriagemDeQualidade)
      : '',
  };
}

function buildNarrative(ctx) {
  const blocos = [];
  if (ctx.descricao) blocos.push(`Descrição do ocorrido:\n${ctx.descricao}`);
  if (ctx.passos) blocos.push(`Passos para reproduzir:\n${ctx.passos}`);
  if (ctx.resultadoEsperado) blocos.push(`Resultado esperado:\n${ctx.resultadoEsperado}`);
  if (ctx.resultadoObtido) blocos.push(`Resultado obtido:\n${ctx.resultadoObtido}`);
  if (ctx.sugestaoMelhoria) blocos.push(`Sugestão de melhoria:\n${ctx.sugestaoMelhoria}`);
  if (ctx.motivoMelhoria) blocos.push(`Motivo de melhoria:\n${ctx.motivoMelhoria}`);
  if (ctx.observacoes) blocos.push(`Observações:\n${ctx.observacoes}`);
  if (ctx.observacoesHu) blocos.push(`Observações para geração HU:\n${ctx.observacoesHu}`);
  if (ctx.observacoesTriagem) blocos.push(`Observações triagem QA:\n${ctx.observacoesTriagem}`);
  return blocos.join('\n\n');
}

function extractDescription(item) {
  if (!item) return '';

  const flat = flattenItem(item);

  const legacy =
    texto(flat.detailText) ||
    texto(flat.DETAIL_TEXT) ||
    texto(flat.comments) ||
    texto(flat.COMMENTS) ||
    texto(flat.ufCrm100_1765292212972) ||
    '';

  if (isMeaningful(legacy)) return legacy;

  const ctx = extractTaskContext(flat);
  const narrative = buildNarrative(ctx);
  if (isMeaningful(narrative)) return narrative;

  if (isMeaningful(ctx.titulo)) {
    return (
      `Título do chamado:\n${ctx.titulo}\n\n` +
      '(Campos de descrição/passos vazios ou placeholders no Bitrix; use o título como única fonte.)'
    );
  }

  const tituloCard = texto(flat.title);
  if (isMeaningful(tituloCard)) {
    return (
      `Título do card:\n${tituloCard}\n\n` +
      '(Sem descrição estruturada preenchida no CRM.)'
    );
  }

  return '';
}

module.exports = { extractDescription, extractTaskContext, buildNarrative, isMeaningful };
