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
 * Campo "Cenários de Teste (Dev)" no SPA — REST costuma ser ufCrm* com cenario+teste+dev.
 * Override: BITRIX_UF_CENARIOS_TESTE_DEV=códigoDoCampo
 */
function textoCenariosTesteDevFromItem(item) {
  if (!item || typeof item !== 'object') return '';

  const envKey = (process.env.BITRIX_UF_CENARIOS_TESTE_DEV || '').trim();
  if (envKey && isMeaningful(item[envKey])) return texto(item[envKey]);

  const fallbacks = [
    'ufCrm94CenariosDeTesteDev',
    'ufCrm94CenariosTesteDev',
    'ufCrm94CenarioDeTesteDev',
  ];
  for (const k of fallbacks) {
    if (isMeaningful(item[k])) return texto(item[k]);
  }

  for (const k of Object.keys(item)) {
    if (!/^ufCrm\d+/i.test(k)) continue;
    const lower = k.toLowerCase();
    if (
      lower.includes('cenario') &&
      lower.includes('teste') &&
      lower.includes('dev')
    ) {
      if (isMeaningful(item[k])) return texto(item[k]);
    }
  }
  return '';
}

/** Anexa bloco do Dev quando o corpo principal não passou por buildNarrative (ex.: legado DETAIL_TEXT). */
function appendCenariosDeTesteDev(base, ctx) {
  const d = ctx.cenariosTesteDev;
  if (!isMeaningful(d)) return base || '';
  const block = `Cenários de Teste (Dev):\n${d}`;
  const b = (base || '').trim();
  if (!b) return block;
  return `${b}\n\n${block}`;
}

const { pickCrmUfText } = require('../utils/crm-field-resolver');

/**
 * Campos do CRM Bitrix (NGF — ufCrm94 / ufCrm100) usados para QA e BDD.
 */
function extractTaskContext(raw) {
  const item = flattenItem(raw);
  return {
    titulo:
      (isMeaningful(item.title) && texto(item.title)) ||
      pickCrmUfText(item, ['NgfTitulo']) ||
      '',

    descricao: pickCrmUfText(item, ['NgfDescricaoDoOcorrido', 'DescricaoDoOcorrido']),

    passos: pickCrmUfText(item, ['NgfPassosParaReproduzir', 'PassosParaReproduzir']),

    resultadoEsperado: pickCrmUfText(item, ['NgfResultadoEsperado', 'ResultadoEsperado']),

    resultadoObtido: pickCrmUfText(item, ['NgfResultadoObtido', 'ResultadoObtido']),

    sugestaoMelhoria: pickCrmUfText(item, ['NgfSugestaoDeMelhoria', 'SugestaoDeMelhoria']),

    motivoMelhoria: pickCrmUfText(item, ['NgfMotivoDeMelhoria', 'MotivoDeMelhoria']),

    observacoes: pickCrmUfText(item, ['NgfObservacoes']),

    observacoesHu: pickCrmUfText(item, ['ObservacoesParaGeracaoHu']),

    observacoesTriagem: pickCrmUfText(item, [
      'NgfObservacoesDaTriagemDeQualidade',
      'ObservacoesDaTriagem',
    ]),

    cenariosTesteDev: (() => {
      const v = textoCenariosTesteDevFromItem(item);
      return isMeaningful(v) ? v : '';
    })(),
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
  if (ctx.cenariosTesteDev) {
    blocos.push(`Cenários de Teste (Dev):\n${ctx.cenariosTesteDev}`);
  }
  return blocos.join('\n\n');
}

function extractDescription(item) {
  if (!item) return '';

  const flat = flattenItem(item);
  const ctx = extractTaskContext(flat);

  const legacy =
    texto(flat.detailText) ||
    texto(flat.DETAIL_TEXT) ||
    texto(flat.comments) ||
    texto(flat.COMMENTS) ||
    texto(flat.ufCrm100_1765292212972) ||
    '';

  if (isMeaningful(legacy)) {
    return appendCenariosDeTesteDev(legacy, ctx);
  }

  const narrative = buildNarrative(ctx);
  if (isMeaningful(narrative)) return narrative;

  if (isMeaningful(ctx.titulo)) {
    return appendCenariosDeTesteDev(
      `Título do chamado:\n${ctx.titulo}\n\n` +
        '(Campos de descrição/passos vazios ou placeholders no Bitrix; use o título como única fonte.)',
      ctx
    );
  }

  const tituloCard = texto(flat.title);
  if (isMeaningful(tituloCard)) {
    return appendCenariosDeTesteDev(
      `Título do card:\n${tituloCard}\n\n` +
        '(Sem descrição estruturada preenchida no CRM.)',
      ctx
    );
  }

  return appendCenariosDeTesteDev('', ctx);
}

module.exports = {
  extractDescription,
  extractTaskContext,
  buildNarrative,
  isMeaningful,
  flattenItem,
};
