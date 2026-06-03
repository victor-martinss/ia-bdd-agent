const {
  entaoVerificavel,
  limparTexto,
  primeiraFrase,
  stripTextoAdministrativo,
  fraseEhIncompleta,
} = require('./bdd-gherkin');
const { entaoEhVago, extrairEntaoDoTexto } = require('./bdd-rigor');

/** Quebra resultado esperado em critérios individuais para Então. */
function splitCriteriosResultado(texto) {
  return String(texto || '')
    .split(/(?:[;\n]|(?<=[.!?])\s+)/)
    .map((p) => p.replace(/[.!?]+$/g, '').trim())
    .filter((p) => p.length >= 8);
}

/**
 * Extrai critérios de validação assertivos a partir dos campos do chamado.
 * @param {object} ctx
 * @returns {{ titulo: string, entao: string, origem: string }[]}
 */
function extrairValidacoesExatas(ctx) {
  const out = [];
  const seen = new Set();

  const add = (origem, texto) => {
    const t = stripTextoAdministrativo(String(texto || ''));
    if (!t || t.length < 8) return;
    const entao = entaoVerificavel(t);
    if (!entao || fraseEhIncompleta(entao) || entaoEhVago(entao)) return;
    const key = entao.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      titulo: origem,
      entao,
      origem,
    });
  };

  if (ctx.resultadoEsperado) {
    const partes = splitCriteriosResultado(ctx.resultadoEsperado);
    for (const p of partes) add('resultado esperado', p);
  }

  if (ctx.resultadoObtido) {
    add('comportamento incorreto (obtido)', ctx.resultadoObtido);
  }

  if (ctx.descricao) {
    const frases = String(ctx.descricao)
      .split(/(?<=[.!?])\s+/)
      .map((f) => f.trim())
      .filter((f) => f.length > 15);
    for (const f of frases) {
      if (/deve|não|nao|exibe|apresenta|erro|mensagem|igual|diferente|sincron/i.test(f)) {
        add('descrição do ocorrido', f);
      }
    }
  }

  if (ctx.evidenceValidacoes && Array.isArray(ctx.evidenceValidacoes)) {
    for (const v of ctx.evidenceValidacoes) {
      add('evidência Dev', v);
    }
  }

  return out;
}

/**
 * Monta bloco de Então assertivo (com referência a evidência quando houver).
 */
function entaoAssertivoDoContexto(ctx, textoDevFallback = '') {
  const corpoBloco = limparTexto(textoDevFallback);
  const fromDevText = extrairEntaoDoTexto(corpoBloco);
  if (fromDevText) {
    const ev = entaoVerificavel(fromDevText);
    if (ev && !entaoEhVago(ev)) return `  Então ${ev}`;
  }

  if (corpoBloco) return null;

  const validacoes = extrairValidacoesExatas(ctx);
  if (validacoes.length === 1 && !entaoEhVago(validacoes[0].entao)) {
    return `  Então ${validacoes[0].entao}`;
  }
  if (validacoes.length > 1) {
    const principal =
      validacoes.find((v) => v.origem.includes('esperado') && !entaoEhVago(v.entao)) ||
      validacoes.find((v) => !entaoEhVago(v.entao));
    if (principal) return `  Então ${principal.entao}`;
  }

  if (ctx.evidenceValidacoes?.length) {
    const ev = entaoVerificavel(ctx.evidenceValidacoes[0]);
    if (ev && !entaoEhVago(ev)) return `  Então ${ev}`;
  }

  if (!onlyTitleMode(ctx) && ctx.resultadoEsperado) {
    const entao = entaoVerificavel(ctx.resultadoEsperado);
    if (entao && !entaoEhVago(entao)) return `  Então ${entao}`;
  }

  return null;
}

function onlyTitleMode(ctx) {
  return ctx && ctx._fontes === 'title_dev_only';
}

/**
 * Texto para prompt LLM com validações numeradas.
 */
function formatarValidacoesParaPrompt(ctx) {
  const vals = extrairValidacoesExatas(ctx);
  if (!vals.length) return '';
  return vals.map((v, i) => `${i + 1}. [${v.origem}] Então: ${v.entao}`).join('\n');
}

module.exports = {
  splitCriteriosResultado,
  extrairValidacoesExatas,
  entaoAssertivoDoContexto,
  formatarValidacoesParaPrompt,
};
