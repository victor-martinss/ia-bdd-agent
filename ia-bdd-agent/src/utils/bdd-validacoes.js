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
/**
 * Divide Resultado Esperado Dev em asserções completas (bullets, setas, frases).
 * @param {string} resultado
 * @returns {string[]}
 */
function splitResultadoDevEmAssercoes(resultado) {
  let t = limparTexto(stripTextoAdministrativo(String(resultado || '')))
    .replace(/^resultado\s+esperado\s*:\s*/i, '')
    .trim();
  if (!t) return [];

  let parts = t
    .split(/\s+-\s+(?=(?:Dado|Given|Caso|Usuário|Na\s|O\s|A\s|O\s+modal|O\s+botão|O\s+ícone))/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 12);
  if (parts.length > 1) {
    return expandirPartesResultadoDev(parts);
  }

  parts = t
    .split(/\s+-\s+(?=Usuário)/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 12);
  if (parts.length > 1) return expandirPartesResultadoDev(parts);

  parts = t
    .split(/(?<=[.!?])\s+(?=["“A-ZÁÉÍÓÚÉO])/u)
    .map((p) => p.trim())
    .filter((p) => p.length >= 12);
  if (parts.length > 1) return expandirPartesResultadoDev(parts);

  const coladas = splitAssercoesColadas(t);
  parts = expandirPartesResultadoDev(coladas.length ? coladas : [t]);
  if (parts.length === 1 && parts[0].length > 80) {
    const extra = parts[0]
      .split(
        /\s+(?=(?:Os|As|O|A|Nenhum|Cada|Se |Uma |A aplicação|A requisição|A alteração|O usuário|O token|O cadastro)\s+)/
      )
      .map((p) => p.trim())
      .filter((p) => p.length >= 12);
    if (extra.length > 1) parts = extra;
  }
  return parts;
}

/** Normaliza partes do Resultado Dev (setas => e frases completas). */
function expandirPartesResultadoDev(partes) {
  const out = [];
  for (const raw of partes) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const mSeta = p.match(/^(.+?)\s*=>\s*(.+)$/s);
    if (mSeta) {
      const entao = mSeta[2].replace(/;\s*$/g, '').trim();
      if (entao.length >= 10) out.push(entao);
      continue;
    }
    if (p.length >= 10) out.push(p);
  }
  return out.filter((p, i, arr) => arr.indexOf(p) === i);
}

/** Então formatado a partir de trecho do Resultado Esperado Dev. */
function formatarEntaoDevResultado(parte) {
  const { entaoVerificavelDev } = require('./bdd-gherkin');
  const p = String(parte || '')
    .trim()
    .replace(/^[-–—]\s+/, '');
  const mSeta = p.match(/^(.+?)\s*=>\s*(.+)$/s);
  if (mSeta) {
    return entaoVerificavelDev(mSeta[2].replace(/;\s*$/g, ''));
  }
  return entaoVerificavelDev(p);
}

const LOOKAHEAD_ASSERCAO_DEV =
  /(?:Não|Nao|Somente|Para\s|cada\s|Cada\s|Exames|Existem|Existe|Estou|Clico|Gerencio|O\s|A\s|Os\s|As\s|Nenhum|Nenhuma|Se\s|Após|Depois|O título|A coluna|A listagem|A tabela|O botão|O documento|A página|Não devem|Não deve|O usuário|As abas|O filtro|O padrão|O texto|A API|A aplicação|O cadastro|O serviço|O sistema|A requisição|O recebimento|O processo|O estudo|A solicitação|[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/;

/** Separa frases coladas por espaço duplo ou início de nova asserção (Dev GWT). */
function splitAssercoesEspacoDuplo(texto) {
  const t = String(texto || '')
    .trim()
    .replace(/\s*---+\s*$/g, '')
    .replace(/…+$/g, '')
    .trim();
  if (!t) return [];

  const porEspaco = t
    .split(/\s{2,}(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 10);

  if (porEspaco.length > 1) return porEspaco;

  const porInicioSeguro = t
    .split(
      /\s+(?=(?:Para cada|Cada nó|Cada\s|As portas|Os campos|O cadastro|A aplicação|O serviço|A requisição|A alteração|A migração|As unidades|As informações|O token|O espaço|O estudo|O gatilho|Nenhum nó|Nenhum token|Nenhum arquivo|Se o protocolo|Se o storage|Após a conclusão|O processo|O recebimento|A solicitação)\b)/i
    )
    .map((p) => p.trim())
    .filter((p) => p.length >= 12);

  if (porInicioSeguro.length > 1) return porInicioSeguro;

  const porInicioAposPonto = t
    .split(
      /(?<=[.!?])\s+(?=(?:Uma mensagem|Nenhuma|O limite|O sistema)\b)/i
    )
    .map((p) => p.trim())
    .filter((p) => p.length >= 12);

  if (porInicioAposPonto.length > 1) return porInicioAposPonto;

  return [t];
}

function splitAssercoesColadas(texto) {
  const t = String(texto || '')
    .trim()
    .replace(/\s*---+\s*$/g, '');
  if (!t) return [];

  if (/\s+-\s+/.test(t)) {
    const porTraco = t
      .split(new RegExp(`\\s+-\\s+(?=${LOOKAHEAD_ASSERCAO_DEV.source})`))
      .map((p) => p.replace(/[.…]+$/g, '').trim())
      .filter((p) => p.length >= 6);
    if (porTraco.length > 1) return porTraco;
  }

  const porEspaco = splitAssercoesEspacoDuplo(t);
  return porEspaco.length ? porEspaco : [t];
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
  const mRes = t.match(/resultado\s+esperado\s*:\s*(.+)$/is);
  if (mRes && mRes[1].trim().length >= 12) return mRes[1].trim();
  const mDevera = t.match(/dever[aá]\s+(.+)$/is);
  if (mDevera && mDevera[1].trim().length >= 12) {
    return `deve ${mDevera[1].trim()}`;
  }
  const mDeve = t.match(/\bdeve\s+((?:ser|retornar|exibir|apresentar|permitir|bloquear|ocorrer|salvar|processar|refletir|obter|validar|sincronizar|enviar|gerar|manter|receber|aplicar|invalidar).+)$/is);
  if (mDeve && mDeve[1].trim().length >= 12) {
    return `deve ${mDeve[1].trim()}`;
  }
  const mValidar = t.match(/^validar\s+que\s+(.+)$/i);
  if (mValidar && mValidar[1].trim().length >= 12) {
    const resto = mValidar[1].trim();
    if (/^n[aã]o\s+/i.test(resto)) {
      return `não deve ${resto.replace(/^n[aã]o\s+/i, '').replace(/^aparece\b/i, 'aparecer')}`;
    }
    return `deve ${resto}`;
  }
  const m = t.match(/^\d+\s*[-–—.)]+\s*(.+)$/);
  const corpo = (m ? m[1] : t).trim();
  if (corpo.length < 10) return '';
  if (
    /\b(fica|deve|exibe|aparece|mostra|mantém|mantem|permanece|não|nao|devem|são|sao|é|e\s+o\s+|e\s+a\s+|com\s+espaçamento|com\s+espacamento|retornad|anonimiz|formato)\b/i.test(
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
  const { entaoVerificavelDev } = require('./bdd-gherkin');
  const fromDevText = extrairEntaoDoTexto(corpoBloco);
  if (fromDevText) {
    const ev = entaoVerificavelDev(fromDevText) || entaoVerificavel(fromDevText);
    if (ev && !entaoEhVago(ev) && !fraseEhIncompleta(ev)) return `  Então ${ev}`;
  }

  const assertaoLista = extrairAssertaoDeBlocoDev(corpoBloco);
  if (assertaoLista) {
    const ev = entaoVerificavelDev(assertaoLista) || entaoVerificavel(assertaoLista);
    if (ev && !entaoEhVago(ev) && !fraseEhIncompleta(ev)) return `  Então ${ev}`;
  }

  const temBlocoDev =
    corpoBloco.length >= 16 ||
    /resultado\s+esperado\s*:|descri[cç][ãa]o\s*:|given\s*:|when\s*:|then\s*:/i.test(
      corpoBloco
    );

  if (temBlocoDev) {
    const mRes = corpoBloco.match(/resultado\s+esperado\s*:\s*(.+)$/is);
    if (mRes) {
      const frases = splitResultadoDevEmAssercoes(mRes[1])
        .map((f) => formatarEntaoDevResultado(f))
        .filter((ev) => ev && !entaoEhVago(ev) && !fraseEhIncompleta(ev));
      if (frases[0]) return `  Então ${frases[0]}`;
    }
    const passoSemAssertao =
      !/deve(?:r[aá])?\s+/i.test(corpoBloco) &&
      !/^resultado\s+esperado\s*:/i.test(corpoBloco) &&
      !/^(?:given|when|then)\s*:/i.test(corpoBloco);
    if (!passoSemAssertao) return null;
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

  if (limparTexto(ctx.descricao) && corpoBloco && /validar|testar/i.test(corpoBloco)) {
    const desc = limparTexto(ctx.descricao);
    const limites = [];
    const mEx = desc.match(/imagens?\s+do\s+exame[^/]*?(\d+\s*MB)/i);
    const mOut = desc.match(/outros?\s+anexos[^.]*?(\d+\s*MB)/i);
    if (mEx) limites.push(`imagens do exame até ${mEx[1]}`);
    if (mOut) limites.push(`outros anexos até ${mOut[1]}`);
    if (limites.length) {
      const compact = /compacta/i.test(desc) ? ' e compactação de imagens' : '';
      return `  Então os anexos devem respeitar os limites (${limites.join('; ')})${compact}`;
    }
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
  splitResultadoDevEmAssercoes,
  formatarEntaoDevResultado,
  splitAssercoesColadas,
  splitAssercoesEspacoDuplo,
  extrairAssertaoDeBlocoDev,
  extrairValidacoesExatas,
  entaoAssertivoDoContexto,
  formatarValidacoesParaPrompt,
};
