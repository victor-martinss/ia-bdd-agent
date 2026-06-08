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
 * Separa asserções coladas com " - " (comum em Cenários Dev inline).
 * Ex.: "não devem aparecer abas - O título deve ser X - A coluna Y"
 */
function splitAssercoesColadas(texto) {
  const t = String(texto || '').trim();
  if (!t || !/\s+-\s+/.test(t)) return t ? [t] : [];

  const lookahead =
    /(?:Não|Nao|Somente|Exames|Existem|Existe|Estou|Clico|Gerencio|O\s|A\s|Os\s|As\s|Nenhum|Nenhuma|Deve|O título|A coluna|A listagem|A tabela|O botão|O documento|A página|Não devem|Não deve|O usuário|As abas|O filtro|O padrão|O texto|A API|[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/;

  const porTraco = t
    .split(new RegExp(`\\s+-\\s+(?=${lookahead.source})`))
    .map((p) => p.replace(/[.…]+$/g, '').trim())
    .filter((p) => p.length >= 6);

  if (porTraco.length > 1) return porTraco;

  const porEspaco = t
    .split(/\s{2,}(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);

  return porEspaco.length > 1 ? porEspaco : [t];
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

function extrairAssertaoDeBlocoDev(texto) {
  const t = limparTexto(String(texto || ''));
  if (!t || t.length < 10) return '';
  const m = t.match(/^\d+\s*[-–—.)]+\s*(.+)$/);
  const corpo = (m ? m[1] : t).trim();
  if (corpo.length < 10) return '';
  if (
    /\b(fica|deve|exibe|aparece|mostra|mantém|mantem|permanece|não|nao|devem|são|sao|é|e\s+o\s+|e\s+a\s+|com\s+espaçamento|com\s+espacamento)\b/i.test(
      corpo
    )
  ) {
    return corpo;
  }
  return '';
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

  const assertaoLista = extrairAssertaoDeBlocoDev(corpoBloco);
  if (assertaoLista) {
    const ev = entaoVerificavel(assertaoLista);
    // Assertões explícitas do Dev (lista numerada) não passam por fraseEhIncompleta — marcas como MobileMed geram falso positivo.
    if (ev && !entaoEhVago(ev)) return `  Então ${ev}`;
  }

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
  splitAssercoesColadas,
  extrairAssertaoDeBlocoDev,
  extrairValidacoesExatas,
  entaoAssertivoDoContexto,
  formatarValidacoesParaPrompt,
};
