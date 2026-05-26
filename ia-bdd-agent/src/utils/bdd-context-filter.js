const {
  limparTexto,
  stripTextoAdministrativo,
  primeiraFrase,
  extrairPassosDoTexto,
  mergePassosFontes,
} = require('./bdd-gherkin');

const RELEVANTE_TESTE =
  /\b(deve|não|nao|exibe|apresenta|erro|mensagem|valida|compar|sincron|protocolo|cpf|paciente|worklist|portal|lista|filtro|salv|cadastr|laud|dicom|permiss|bloque|vazio|inv[aá]lid|esperado|obtido|defeito|falha|igual|diferente|ausente|presente|bot[aã]o|campo|tela|modal|grava|export)\b/i;

const RUIDO =
  /\b(tarefa\s+aberta|evid[eê]ncias?\s+enviadas?|solicita(?:do)?|anexo|print|screenshot|v[ií]deo\s+anexo|mobilemed\s+inf)\b/i;

function frasesRelevantes(texto, maxFrases = 6) {
  if (!limparTexto(texto)) return [];
  const limpo = stripTextoAdministrativo(texto);
  const frases = limpo
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.trim())
    .filter((f) => f.length >= 12 && !RUIDO.test(f));

  const out = [];
  const seen = new Set();
  for (const f of frases) {
    if (!RELEVANTE_TESTE.test(f) && out.length > 0) continue;
    const key = f.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f.slice(0, 220));
    if (out.length >= maxFrases) break;
  }
  if (!out.length && limpo.length >= 20) {
    return [primeiraFrase(limpo).slice(0, 220)];
  }
  return out;
}

function resumirEvidencias(texto, maxChars = 520) {
  if (!limparTexto(texto)) return '';
  const linhas = String(texto)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^evidências encontradas:/i.test(l))
    .filter((l) => !/configure openai/i.test(l));

  const uteis = [];
  for (const l of linhas) {
    if (RUIDO.test(l) && !RELEVANTE_TESTE.test(l)) continue;
    if (/vídeos?\s*\(\d+\)/i.test(l) && !RELEVANTE_TESTE.test(l)) {
      uteis.push(l.slice(0, 120));
      continue;
    }
    if (RELEVANTE_TESTE.test(l) || /passos visíveis|análise|mostra|exibe|mensagem|defeito/i.test(l)) {
      uteis.push(l.slice(0, 200));
    }
  }

  const blob = uteis.join('\n').trim() || linhas.slice(0, 4).join('\n');
  return blob.slice(0, maxChars);
}

function passosObjetivosDoContexto(ctx) {
  const fontes = [
    ctx.passosFiltrados || ctx.passos,
    ...(ctx.passosEvidencia || []),
  ].filter(Boolean);

  let merged = mergePassosFontes(...fontes);
  if (!merged && ctx.descricaoFiltrada) {
    merged = mergePassosFontes(ctx.descricaoFiltrada);
  }

  const passos = extrairPassosDoTexto(merged);
  const seen = new Set();
  const out = [];
  for (const p of passos) {
    const key = p.toLowerCase().replace(/\s+/g, ' ').slice(0, 70);
    if (!key || seen.has(key)) continue;
    const dup = out.some(
      (o) => o.includes(key.slice(0, 35)) || key.includes(o.toLowerCase().slice(0, 35))
    );
    if (dup) continue;
    seen.add(key);
    out.push(p.slice(0, 140));
    if (out.length >= 8) break;
  }
  return out;
}

function extrairPalavrasChave(ctx) {
  const blob = [
    ctx.titulo,
    ctx.descricaoFiltrada || ctx.descricao,
    ctx.passosFiltrados || ctx.passos,
    ctx.resultadoEsperado,
    ctx.resultadoObtido,
    ctx.cenariosTesteDev,
    ctx.evidenceResumoFiltrado || ctx.evidenceResumo,
    ctx.observacoesTriagem,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  const tags = [];
  const padroes = [
    ['worklist', /\bworklist\b/],
    ['portal', /\bportal\b/],
    ['protocolo', /\bprotocolo\b/],
    ['cpf', /\bcpf\b/],
    ['sincron', /\bsincron/],
    ['compar', /\bcompar/],
    ['laud', /\blaud/],
    ['dicom', /\bdicom\b/],
    ['permiss', /\bpermiss/],
    ['filtro', /\bfiltro|pesquisa|busca\b/],
    ['valid', /\bvalid|inv[aá]lid/],
    ['defeito', /\bdefeito|obtido|incorreto|falha\b/],
    ['integracao', /\bentre\s+(sistemas|telas)|worklist.*portal|portal.*worklist\b/],
  ];
  for (const [tag, re] of padroes) {
    if (re.test(blob)) tags.push(tag);
  }
  return [...new Set(tags)];
}

function montarResumoObjetivo(ctx) {
  const partes = [];
  if (ctx.titulo) partes.push(`Foco: ${stripTextoAdministrativo(ctx.titulo).slice(0, 100)}`);
  if (ctx.palavrasChaveTeste?.length) {
    partes.push(`Áreas: ${ctx.palavrasChaveTeste.join(', ')}`);
  }
  if (ctx.resultadoObtido) {
    partes.push(`Defeito: ${primeiraFrase(ctx.resultadoObtido).slice(0, 120)}`);
  } else if (ctx.resultadoEsperado) {
    partes.push(`Aceite: ${primeiraFrase(ctx.resultadoEsperado).slice(0, 120)}`);
  }
  if (ctx.qaHistorico?.isRetornoQa) {
    partes.push(`Histórico QA: retorno/reprovação — priorizar regressão do defeito`);
  }
  return partes.join(' | ').slice(0, 400);
}

/**
 * Reduz ruído do CRM e mantém só o que orienta cenários de teste.
 * @param {object} ctx
 * @returns {object}
 */
function aplicarFiltroContexto(ctx) {
  if (!ctx || process.env.BDD_CONTEXT_FILTER === '0') {
    return ctx;
  }

  const descricaoFrases = frasesRelevantes(ctx.descricao, 5);
  const triagemFrases = frasesRelevantes(ctx.observacoesTriagem, 3);

  const passosEvidencia = Array.isArray(ctx.passosEvidencia) ? ctx.passosEvidencia : [];
  const passosFiltrados = mergePassosFontes(
    ctx.passos,
    passosEvidencia.join('\n'),
    descricaoFrases.length && !limparTexto(ctx.passos) ? descricaoFrases.join('\n') : ''
  );

  const filtrado = {
    ...ctx,
    descricaoFiltrada: descricaoFrases.join(' ').trim() || stripTextoAdministrativo(ctx.descricao || '').slice(0, 280),
    passosFiltrados: passosFiltrados || ctx.passos || '',
    evidenceResumoFiltrado: resumirEvidencias(ctx.evidenceResumo),
    observacoesTriagemFiltrada: triagemFrases.join(' ').trim() || (ctx.observacoesTriagem || '').slice(0, 200),
    passosEvidencia,
    passosObjetivos: [],
    palavrasChaveTeste: [],
    resumoObjetivo: '',
  };

  filtrado.passosObjetivos = passosObjetivosDoContexto(filtrado);
  filtrado.palavrasChaveTeste = extrairPalavrasChave(filtrado);
  filtrado.resumoObjetivo = montarResumoObjetivo(filtrado);

  return filtrado;
}

module.exports = {
  aplicarFiltroContexto,
  frasesRelevantes,
  resumirEvidencias,
  passosObjetivosDoContexto,
  extrairPalavrasChave,
};
