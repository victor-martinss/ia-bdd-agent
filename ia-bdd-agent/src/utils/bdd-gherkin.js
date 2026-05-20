/**
 * Transforma textos do CRM em passos Gherkin objetivos (Dado / Quando / Então / E).
 * Lê descrição/passos/resultados e resume — nunca cola parágrafos inteiros no cenário.
 */

const {
  detectAmbiente,
  dadoAcessaAmbiente,
  onlyTitleAndDevSources,
} = require('./bdd-ambiente');

const MAX_PASSO_CHARS =
  Number.parseInt(process.env.BDD_MAX_STEP_CHARS || '100', 10) || 100;
const MAX_PASSO_PALAVRAS =
  Number.parseInt(process.env.BDD_MAX_STEP_WORDS || '18', 10) || 18;

function limparTexto(s) {
  if (s == null || s === '') return '';
  return String(s)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '');
}

/** Remove rodapés administrativos do Bitrix (evidências, nomes, "tarefa aberta"). */
function stripTextoAdministrativo(texto) {
  let t = limparTexto(texto);
  if (!t) return '';

  t = t
    .replace(
      /\b(tarefa\s+aberta|evid[eê]ncias?|enviadas?\s+por|solicita(?:do)?|pela?\s+[\w.]+\s*NQ|inf\s+e\s+evid[eê]ncias?).*$/gi,
      ''
    )
    .replace(/\b(isabelly|mobilemed)\s*\w*$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return t;
}

/** Rótulos de formulário que não são passos de teste. */
function linhaEhRotuloChamado(texto) {
  const t = limparTexto(texto).toLowerCase();
  if (!t || t.length < 4) return true;
  return (
    /^passos?\s+(para\s+)?reproduzir\.?$/i.test(t) ||
    /^descri[çc][aã]o(\s+do\s+ocorrido)?\.?$/i.test(t) ||
    /^contexto\.?$/i.test(t) ||
    /^resultado\s+(esperado|obtido)\.?$/i.test(t) ||
    /^cen[aá]rio\s+de\s+teste\.?$/i.test(t) ||
    /^inf\s+e\s+evid/i.test(t)
  );
}

/** Nome curto da funcionalidade (módulo), sem squad/FEATURE repetido. */
function nomeFuncionalidadeCurto(titulo) {
  let t = stripTextoAdministrativo(String(titulo || ''));
  if (!t) return 'Funcionalidade do chamado';

  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (partes.length >= 2) {
    const mod = partes[0].replace(/^\[?\s*FEATURE\s*\]?\s*/i, '').trim();
    const fluxo = partes.slice(1).join(' — ').slice(0, 90);
    return fluxo ? `${mod} — ${fluxo}` : mod;
  }

  return t.slice(0, 120);
}

/** Transforma resultado esperado/obtido em frase verificável para Então. */
function entaoVerificavel(texto) {
  let t = stripTextoAdministrativo(primeiraFrase(texto) || texto);
  if (!t) return '';

  t = t
    .replace(/^é\s+exibid[oa]\s+(a\s+)?mensagem\s*:?\s*/i, 'exibe a mensagem ')
    .replace(/^deve\s+ser\s+/i, 'é ')
    .replace(/^deve\s+/i, '')
    .replace(/^deverá\s+/i, '')
    .replace(/^o\s+sistema\s+deve\s+/i, '')
    .replace(/^o\s+sistema\s+/i, '')
    .trim();

  t = objetivarFrase(t, 110);
  if (!t) return '';

  if (/^(o|a|os|as|nenhum|nenhuma)\s/i.test(t)) return t;
  if (/^(exibe|apresenta|permanece|são|está|continua)/i.test(t)) return t;
  return t;
}

function primeiraFrase(texto) {
  const t = limparTexto(texto);
  if (!t) return '';
  const m = t.match(/^[^.!?\n]+[.!?]?/);
  return (m ? m[0] : t).trim();
}

function removerRotulos(texto) {
  return limparTexto(texto).replace(
    /^(descrição|contexto|passo|resultado|observação)\s*(do\s+ocorrido)?\s*:\s*/i,
    ''
  );
}

/** Remove artefatos comuns de formulários Bitrix / listas coladas. */
function removerRuidoColagem(texto) {
  let f = limparTexto(texto);
  if (!f) return '';

  f = f
    .replace(/\[cenário de teste\s*\d+\]\s*:?\s*/gi, '')
    .replace(/\{cenário\s*\d+\s*\}\s*-?\s*/gi, '')
    .replace(/^cenário\s*\d+\s*[-:]\s*/i, '')
    .replace(/^\d+\s*(?:[-–—.)]+)\s*/, '')
    .replace(/^[-*•]\s*/, '')
    .replace(/\s*\.\s*\.\s*\./g, '.')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/"""[\s\S]*?"""/g, '')
    .trim();

  return f;
}

function limitarPalavras(frase, max = MAX_PASSO_PALAVRAS) {
  const partes = frase.split(/\s+/).filter(Boolean);
  if (partes.length <= max) return frase;
  return partes.slice(0, max).join(' ');
}

/** Indica se o texto parece parágrafo colado (não serve como passo Gherkin). */
function passoEhColagemDescricao(texto) {
  const t = limparTexto(texto);
  if (!t) return true;
  if (t.length > MAX_PASSO_CHARS * 1.5) return true;
  const palavras = t.split(/\s+/).length;
  if (palavras > MAX_PASSO_PALAVRAS + 4) return true;
  if (/\d+\s*[-–—]\s*.+\d+\s*[-–—]/.test(t)) return true;
  if (/(mesmo\s+com|apesar\s+de).{80,}/i.test(t)) return true;
  if (/^[\d\s.\-–—]+$/.test(t)) return true;
  return false;
}

/** Frase curta e testável, sem colar parágrafos do chamado. */
function objetivarFrase(frase, maxLen = MAX_PASSO_CHARS) {
  let f = removerRuidoColagem(removerRotulos(frase));
  if (!f || passoEhColagemDescricao(f)) {
    f = removerRuidoColagem(primeiraFrase(frase));
  }
  if (!f) return '';

  f = f
    .replace(/^(mesmo\s+com|apesar\s+de|quando|se)\s+/i, '')
    .replace(/^é\s+exibid[oa]\s+(a\s+)?mensagem\s*:?\s*/i, 'exibe a mensagem ');
  if (!/^(está|esta|são|é|existe|há|o\s+usuário)/i.test(f)) {
    f = f.replace(/^o\s+usuário\s+/i, '');
  }
  f = f
    .replace(/^que\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!f) return '';

  const verbosAcao =
    /^(informa|clica|acessa|envia|visualiza|preenche|seleciona|abre|cadastra|exporta|tenta|valida|confirma|realiza|inicia|sai|alterna|fecha|entra|configura|cria|aguarda|compara|verifica|anota|aplica|registra|abre|selecionar|configurar|criar|aguardar|comparar|verificar|anotar|aplicar|registrar|cadastrar|enviar|clicar|informar|acessar|visualizar|preencher|abrir|exportar|validar|confirmar|iniciar|sair|alternar|fechar|entrar|realizar)/i;
  if (verbosAcao.test(f)) {
    f = f
      .replace(/^cadastrar\b/i, 'cadastra')
      .replace(/^enviar\b/i, 'envia')
      .replace(/^verificar\b/i, 'verifica')
      .replace(/^clicar\b/i, 'clica')
      .replace(/^informar\b/i, 'informa')
      .replace(/^acessar\b/i, 'acessa')
      .replace(/^visualizar\b/i, 'visualiza')
      .replace(/^preencher\b/i, 'preenche')
      .replace(/^selecionar\b/i, 'seleciona')
      .replace(/^abrir\b/i, 'abre')
      .replace(/^exportar\b/i, 'exporta')
      .replace(/^tentar\b/i, 'tenta')
      .replace(/^validar\b/i, 'valida')
      .replace(/^confirmar\b/i, 'confirma')
      .replace(/^realizar\b/i, 'realiza')
      .replace(/^iniciar\b/i, 'inicia')
      .replace(/^sair\b/i, 'sai')
      .replace(/^alternar\b/i, 'alterna')
      .replace(/^fechar\b/i, 'fecha')
      .replace(/^entrar\b/i, 'entra')
      .replace(/^configurar\b/i, 'configura')
      .replace(/^criar\b/i, 'cria')
      .replace(/^aguardar\b/i, 'aguarda')
      .replace(/^comparar\b/i, 'compara')
      .replace(/^verificar\b/i, 'verifica')
      .replace(/^anotar\b/i, 'anota')
      .replace(/^confirmar\b/i, 'confirma')
      .replace(/^selecionar\b/i, 'seleciona')
      .replace(/^aplicar\b/i, 'aplica')
      .replace(/^registrar\b/i, 'registra');
    if (!/^o usuário\s/i.test(f)) {
      f = `o usuário ${f.charAt(0).toLowerCase()}${f.slice(1)}`;
    }
  }

  if (/^(está|esta|são|é|existe|há|permanece|continua)/i.test(f) && !/^o\s+usuário/i.test(f)) {
    f = `o usuário ${f.charAt(0).toLowerCase()}${f.slice(1)}`;
  }

  f = limitarPalavras(f);

  if (f.length > maxLen) {
    const cortada = f.slice(0, maxLen);
    const ultimoEspaco = cortada.lastIndexOf(' ');
    f = (ultimoEspaco > 24 ? cortada.slice(0, ultimoEspaco) : cortada).trim();
  }

  f = f.replace(/[.!?]+$/g, '').trim();
  if (!f || passoEhColagemDescricao(f)) return '';
  return f.charAt(0).toLowerCase() + f.slice(1);
}

function passoGherkin(tipo, texto) {
  const corpo = objetivarFrase(texto);
  if (!corpo) return null;
  const map = {
    dado: 'Dado que',
    quando: 'Quando',
    entao: 'Então',
    então: 'Então',
    e: 'E',
  };
  const prefix = map[tipo.toLowerCase()] || 'E';
  if (prefix === 'E') return `    E ${corpo}`;
  if (prefix === 'Dado que') return `  Dado que ${corpo}`;
  if (prefix === 'Quando') return `  Quando ${corpo}`;
  return `  Então ${corpo}`;
}

/**
 * Extrai itens de listas numeradas ou por linha (1 -, 2), bullets).
 * @param {string} texto
 * @returns {string[]}
 */
function preservarQuebrasDeLinha(texto) {
  return String(texto || '')
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(
      /^(descrição|contexto|passo|resultado|observação)\s*(do\s+ocorrido)?\s*:\s*/gim,
      ''
    );
}

function extrairPassosDoTexto(texto) {
  if (!texto || !preservarQuebrasDeLinha(texto)) return [];

  const bruto = preservarQuebrasDeLinha(texto);
  const encontrados = [];

  const marcadores = bruto.match(/\d+\s*(?:[-–—.)]+)\s/g) || [];
  if (marcadores.length >= 2) {
    const blocos = bruto.split(/(?=\d+\s*(?:[-–—.)]+)\s)/).map((p) => p.trim()).filter(Boolean);
    for (const p of blocos) {
      const m = p.match(/^\d+\s*(?:[-–—.)]+)\s*(.+)$/s);
      if (m && m[1]) encontrados.push(m[1].trim());
    }
    if (encontrados.length) return encontrados;
  }

  for (const raw of bruto.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length < 3) continue;
    if (linhaEhRotuloChamado(line)) continue;

    const mNum = line.match(/^\d+\s*(?:[-–—.)]+)\s*(.+)$/);
    if (mNum && mNum[1]) {
      encontrados.push(mNum[1].trim());
      continue;
    }

    const inline = line.split(/(?=\d+\s*(?:[-–—.)]+)\s)/).map((p) => p.trim()).filter(Boolean);
    if (inline.length > 1) {
      for (const p of inline) {
        const m = p.match(/^\d+\s*(?:[-–—.)]+)\s*(.+)$/);
        if (m && m[1]) encontrados.push(m[1].trim());
      }
      continue;
    }

    if (line.length >= 4 && !passoEhColagemDescricao(line)) {
      const subPassos = line.split(
        /\s+e\s+(?=(?:verificar|validar|confirmar|comparar|acessar|abrir|visualizar|anotar)\b)/i
      );
      if (subPassos.length > 1) {
        for (const sp of subPassos) {
          const t = sp.trim();
          if (t.length >= 4) encontrados.push(t);
        }
      } else {
        encontrados.push(line);
      }
    }
  }

  if (!encontrados.length) {
    const partes = bruto
      .split(/(?<=[.!?])\s+|;\s*|\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 3 && !passoEhColagemDescricao(p));
    return partes;
  }

  return encontrados;
}

/**
 * Divide passos em frases e gera Quando / E.
 * @param {string} passos
 * @param {{ maxLinhas?: number }} [opts]
 */
function passosParaStepsGherkin(passos, opts = {}) {
  const max =
    Number.parseInt(process.env.BDD_MAX_PASSO_LINES || '8', 10) || 8;
  const maxLinhas = opts.maxLinhas ?? max;

  const partes = extrairPassosDoTexto(passos);
  if (!partes.length) {
    return [];
  }

  const linhas = [];
  const vistos = new Set();

  for (const p of partes) {
    if (linhas.length >= maxLinhas) break;
    if (linhaEhRotuloChamado(p)) continue;
    const corpo = objetivarFrase(p);
    if (!corpo || vistos.has(corpo) || linhaEhRotuloChamado(corpo)) continue;
    vistos.add(corpo);
    if (linhas.length === 0) linhas.push(`  Quando ${corpo}`);
    else linhas.push(`    E ${corpo}`);
  }

  return linhas;
}

function linhaJaEhGherkin(line) {
  return /^\s*(dado|quando|então|entao|e)\s/i.test(line);
}

function normalizarLinhaGherkin(line) {
  const t = line.trim();
  const m = t.match(/^(dado|quando|então|entao|e)\s*(que\s+)?(.+)$/i);
  if (!m) return null;
  const tipo = m[1].toLowerCase();
  const bruto = (m[3] || '').trim();

  if (tipo === 'entao' || tipo === 'então') {
    const ev = entaoVerificavel(bruto) || objetivarFrase(bruto);
    return ev ? `  Então ${ev}` : null;
  }

  if (tipo === 'dado') {
    if (/^o\s+usuário\s+/i.test(bruto)) return `  Dado que ${bruto}`;
    const prep = objetivarFrase(bruto) || bruto;
    return prep ? `  Dado que ${prep}` : null;
  }

  const resto = objetivarFrase(bruto);
  if (!resto) return null;
  if (tipo === 'quando') return `  Quando ${resto}`;
  return `    E ${resto}`;
}

/**
 * Junta passos de várias fontes (Dev, descrição, passos NGF) sem duplicar.
 * @param {...string} fontes
 */
function mergePassosFontes(...fontes) {
  const items = [];
  const seen = new Set();
  for (const f of fontes) {
    if (!f || !limparTexto(f)) continue;
    for (const p of extrairPassosDoTexto(f)) {
      const key = p.toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(p);
    }
  }
  return items.join('\n');
}

/**
 * Divide o campo "Cenários de Teste (Dev)" em blocos (um por cenário Dev).
 * @param {string} texto
 * @returns {{ title: string|null, body: string, lines: string[] }[]}
 */
function parseCenariosDevBlocos(texto) {
  const bruto = String(texto || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .trim();
  if (!limparTexto(bruto)) return [];

  const porCenario = bruto.split(/(?=^\s*(?:cenário|cenario)\s*:)/gim).filter((c) => limparTexto(c));
  if (porCenario.length >= 1 && /(?:cenário|cenario)\s*:/i.test(bruto)) {
    return porCenario.map((chunk) => parseDevChunk(chunk));
  }
  if (porCenario.length > 1) {
    return porCenario.map((chunk) => parseDevChunk(chunk));
  }

  const porMarcador = bruto.split(/(?=\[\s*cenário|\{\s*cenário)/gi).filter((c) => limparTexto(c));
  if (porMarcador.length > 1) {
    return porMarcador.map((chunk) => parseDevChunk(chunk));
  }

  const porNumero = bruto.split(/(?=^\s*\d+\s*(?:[-–—.)]+)\s)/m).filter((c) => limparTexto(c));
  if (porNumero.length > 1) {
    return porNumero.map((chunk, i) => parseDevChunk(chunk, `Passo ${i + 1}`));
  }

  return [parseDevChunk(bruto, null)];
}

function parseDevChunk(chunk, tituloFallback = null) {
  const lines = chunk.split(/\r?\n/).map((l) => l.trimEnd());
  const first = (lines.find((l) => l.trim()) || '').trim();
  let title = tituloFallback;

  const mCen = first.match(/^(?:cenário|cenario)\s*:\s*(.+)$/i);
  if (mCen) {
    title = mCen[1].trim();
    lines.shift();
  } else {
    const mMarc = first.match(/\[\s*cenário[^\]]*\]\s*:?\s*(.*)$/i);
    if (mMarc) {
      title = (mMarc[1] || first).trim() || tituloFallback;
    }
  }

  const body = lines.join('\n').trim();
  return { title: title || null, body, lines: lines.filter((l) => l.trim()) };
}

function extrairLinhasGherkinDoBloco(lines) {
  const gherkin = [];
  for (const line of lines || []) {
    if (linhaJaEhGherkin(line)) {
      const norm = normalizarLinhaGherkin(line);
      if (norm) gherkin.push(norm);
    }
  }
  return gherkin;
}

/**
 * Cenário QA derivado de um bloco Dev + descrição/passos/resultado da tarefa.
 */
function cenarioQaAPartirDoDev(bloco, ctx, nomeFuncionalidade) {
  const nomeCenario = bloco.title
    ? bloco.title.replace(/\s+/g, ' ').slice(0, 100)
    : `${nomeFuncionalidadeCurto(nomeFuncionalidade)} — validação`;
  const out = [`Cenário: ${nomeCenario}`];

  const gherkinDev = extrairLinhasGherkinDoBloco(bloco.lines);
  if (gherkinDev.length >= 2) {
    out.push(...montarDadosIniciais(ctx));
    for (const ln of gherkinDev) {
      if (/^\s*Dado/i.test(ln)) continue;
      out.push(ln);
    }
    if (!gherkinDev.some((l) => /^\s*Então/i.test(l))) {
      const entao = entaoDoContexto(ctx, bloco.body);
      if (entao) out.push(entao);
    }
    return out;
  }

  out.push(...montarDadosIniciais(ctx));
  const passosMerged =
    bloco.body && limparTexto(bloco.body)
      ? mergePassosFontes(
          bloco.body,
          onlyTitleAndDevSources() ? '' : ctx.passos
        )
      : onlyTitleAndDevSources()
        ? ''
        : mergePassosFontes(ctx.passos, ctx.descricao);
  const quando = passosParaStepsGherkin(passosMerged);
  if (quando.length) out.push(...quando);
  else out.push('  Quando o usuário executa os passos descritos no cenário Dev');
  const entao = entaoDoContexto(ctx, bloco.body);
  out.push(entao || '  Então o resultado na tela corresponde ao esperado');
  return out;
}

function entaoDoContexto(ctx, textoDevFallback = '') {
  if (!onlyTitleAndDevSources() && ctx && limparTexto(ctx.resultadoEsperado)) {
    const entao = entaoVerificavel(ctx.resultadoEsperado);
    return entao ? `  Então ${entao}` : '  Então o resultado exibido corresponde ao esperado';
  }
  const fromDev = String(textoDevFallback || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^ent[aã]o\s/i.test(l));
  if (fromDev) {
    const ev = entaoVerificavel(fromDev.replace(/^ent[aã]o\s*/i, ''));
    if (ev) return `  Então ${ev}`;
  }
  return '  Então o comportamento descrito no cenário Dev é observado na tela';
}

/**
 * Cenário principal QA a partir da descrição e passos da tarefa (sem bloco Dev).
 */
function cenarioPrincipalNgf(ctx, nomeFuncionalidade) {
  const nomeCurto = nomeFuncionalidadeCurto(nomeFuncionalidade);
  const out = [`Cenário: ${nomeCurto} — validação principal`];
  out.push(...montarDadosIniciais(ctx));
  const quando = passosParaStepsGherkin(resolverPassosReproducao(ctx));
  if (quando.length) out.push(...quando);
  else out.push('  Quando o usuário reproduz o fluxo descrito no chamado');
  out.push(entaoDoContexto(ctx));
  return out;
}

/**
 * Converte bloco "Cenários de Teste (Dev)" em passos E resumidos.
 */
function devCenariosParaPassosE(texto) {
  if (!texto || !limparTexto(texto)) return [];

  const linhas = [];
  const vistos = new Set();

  for (const item of extrairPassosDoTexto(texto)) {
    if (linhas.length >= 6) break;

    if (linhaJaEhGherkin(item)) {
      const norm = normalizarLinhaGherkin(item);
      if (norm && norm.startsWith('    E ') && !vistos.has(norm)) {
        vistos.add(norm);
        linhas.push(norm);
      }
      continue;
    }

    const obj = objetivarFrase(item);
    if (!obj) continue;
    const linha = `    E ${obj}`;
    if (vistos.has(linha)) continue;
    vistos.add(linha);
    linhas.push(linha);
  }

  return linhas;
}

/**
 * Resume a descrição como pré-condição (uma frase curta de contexto).
 */
function precondicaoDaDescricao(descricao) {
  if (!descricao || !limparTexto(descricao)) return '';

  const comMesmo = descricao.match(
    /(?:mesmo\s+com|com)\s+(.+?)(?:,|\s+o\s+|\s+que\s+|$)/i
  );
  if (comMesmo && comMesmo[1]) {
    const prep = objetivarFrase(comMesmo[1], 80);
    if (prep) return prep;
  }

  const frase = primeiraFrase(descricao);
  if (/gera|apresenta|não|nao|em vez|invés|falha|erro|exibe a mensagem/i.test(frase)) {
    return '';
  }
  return objetivarFrase(frase, 80);
}

function inferirModuloDoTitulo(titulo) {
  const t = stripTextoAdministrativo(String(titulo || ''));
  if (!t) return '';
  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  const mod = (partes[0] || t)
    .replace(/^\[?\s*FEATURE\s*\]?\s*/i, '')
    .replace(/^squad\s+\w+\s*-\s*/i, '')
    .trim();
  return mod.slice(0, 60);
}

function montarDadosIniciais(ctx) {
  const ambiente =
    (ctx && ctx.ambiente) || detectAmbiente(ctx && ctx.titulo, ctx && ctx.cenariosTesteDev);
  const out = [dadoAcessaAmbiente(ambiente)];

  if (!onlyTitleAndDevSources() && ctx && ctx.descricao) {
    const ctxResumo = precondicaoDaDescricao(ctx.descricao);
    if (ctxResumo && !linhaEhRotuloChamado(ctxResumo)) {
      out.push(`    E ${ctxResumo}`);
    }
  }
  return out;
}

function ctxTemCamposEstruturados(ctx) {
  if (!ctx) return false;
  return !!(
    limparTexto(ctx.passos) ||
    limparTexto(ctx.descricao) ||
    limparTexto(ctx.resultadoEsperado) ||
    limparTexto(ctx.cenariosTesteDev) ||
    limparTexto(ctx.resultadoObtido)
  );
}

/** Passos para Quando: prioriza passos NGF; descrição só se não houver passos. */
function resolverPassosReproducao(ctx) {
  const merged = mergePassosFontes(ctx.passos, ctx.descricao);
  if (merged) return merged;
  if (limparTexto(ctx.passos)) return ctx.passos;
  return '';
}

/**
 * Quando o card só tem título (campos NGF vazios), monta passos a partir do título.
 */
function passosAPartirDoTitulo(titulo) {
  const t = limparTexto(titulo);
  if (!t) return passosParaStepsGherkin('');

  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  const modulo = objetivarFrase(partes[0] || t, 60) || partes[0] || t;
  const fluxo = partes.length > 1 ? partes.slice(1).join(' ') : t;
  const fluxoObj = objetivarFrase(fluxo, 70) || objetivarFrase(t, 70);

  return [
    `    E o usuário acessa o módulo ${modulo}`,
    fluxoObj
      ? `  Quando ${fluxoObj}`
      : '  Quando o usuário executa o fluxo descrito no chamado',
  ];
}

function entaoAPartirDoTitulo(titulo) {
  const t = limparTexto(titulo);
  if (!t) return '  Então o comportamento deve estar alinhado à regra de negócio do chamado';
  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  const alvo = partes.length > 1 ? partes.slice(1).join(' ') : t;
  const obj = objetivarFrase(`o fluxo "${alvo}" é concluído com sucesso`, 90);
  return obj ? `  Então ${obj}` : '  Então o fluxo do chamado é concluído com sucesso';
}

/**
 * Pós-processa feature inteira: encurta passos, remove colagens.
 * @param {string} feature
 */
function sanitizarFeatureBdd(feature) {
  if (!feature || typeof feature !== 'string') return '';

  const linhas = feature.split(/\r?\n/);
  const out = [];

  for (const line of linhas) {
    const trimmed = line.trimEnd();

    if (!trimmed) {
      out.push('');
      continue;
    }

    if (/^funcionalidade\s*:/i.test(trimmed) || /^cenário\s*:/i.test(trimmed)) {
      out.push(trimmed);
      continue;
    }

    if (/^\s*dado\s+que\s+/i.test(trimmed) && /o\s+usuário/i.test(trimmed)) {
      out.push(trimmed.replace(/^\s*/g, '  '));
      continue;
    }

    if (/^\s*então\s+/i.test(trimmed) && trimmed.length < 140) {
      const ev = entaoVerificavel(trimmed.replace(/^\s*então\s+/i, ''));
      if (ev) {
        out.push(`  Então ${ev}`);
        continue;
      }
    }

    if (/^\s*mas\b/i.test(trimmed)) {
      const resto = objetivarFrase(
        trimmed.replace(/^\s*mas\s+(?:o\s+esperado\s+era\s*:?\s*)?/i, '')
      );
      if (resto) out.push(`    Mas o esperado era: ${resto}`);
      continue;
    }

    if (linhaJaEhGherkin(trimmed)) {
      const norm = normalizarLinhaGherkin(trimmed);
      if (norm) out.push(norm);
      continue;
    }

    if (trimmed.startsWith('#')) {
      out.push(trimmed);
      continue;
    }

    const obj = objetivarFrase(trimmed);
    if (obj) out.push(`    E ${obj}`);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = {
  limparTexto,
  stripTextoAdministrativo,
  linhaEhRotuloChamado,
  nomeFuncionalidadeCurto,
  entaoVerificavel,
  primeiraFrase,
  objetivarFrase,
  passoGherkin,
  passosParaStepsGherkin,
  extrairPassosDoTexto,
  mergePassosFontes,
  parseCenariosDevBlocos,
  cenarioQaAPartirDoDev,
  cenarioPrincipalNgf,
  entaoDoContexto,
  devCenariosParaPassosE,
  montarDadosIniciais,
  inferirModuloDoTitulo,
  removerRotulos,
  ctxTemCamposEstruturados,
  passosAPartirDoTitulo,
  entaoAPartirDoTitulo,
  resolverPassosReproducao,
  sanitizarFeatureBdd,
  passoEhColagemDescricao,
};
