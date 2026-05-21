const {
  entaoVerificavel,
  limparTexto,
  primeiraFrase,
  stripTextoAdministrativo,
} = require('./bdd-gherkin');

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
    const entao = entaoVerificavel(t) || t.slice(0, 110);
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
    const partes = String(ctx.resultadoEsperado).split(/[;\n]+/).map((p) => p.trim());
    for (const p of partes) add('resultado esperado', p);
    if (partes.length === 1) add('resultado esperado', ctx.resultadoEsperado);
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
  const validacoes = extrairValidacoesExatas(ctx);
  if (validacoes.length === 1) {
    return `  Então ${validacoes[0].entao}`;
  }
  if (validacoes.length > 1) {
    const principal = validacoes.find((v) => v.origem.includes('esperado')) || validacoes[0];
    return `  Então ${principal.entao}`;
  }

  if (ctx.evidenceResumo && limparTexto(ctx.evidenceResumo)) {
    const frase = primeiraFrase(ctx.evidenceResumo);
    const ev = entaoVerificavel(frase);
    if (ev) return `  Então ${ev}`;
  }

  if (!onlyTitleMode(ctx) && ctx.resultadoEsperado) {
    const entao = entaoVerificavel(ctx.resultadoEsperado);
    if (entao) return `  Então ${entao}`;
  }

  const fromDev = String(textoDevFallback || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^ent[aã]o\s/i.test(l));
  if (fromDev) {
    const ev = entaoVerificavel(fromDev.replace(/^ent[aã]o\s*/i, ''));
    if (ev) return `  Então ${ev}`;
  }

  return '  Então o comportamento na tela corresponde ao critério de aceite do chamado';
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
  extrairValidacoesExatas,
  entaoAssertivoDoContexto,
  formatarValidacoesParaPrompt,
};
