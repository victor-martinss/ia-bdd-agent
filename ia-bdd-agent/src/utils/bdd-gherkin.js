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
  Number.parseInt(process.env.BDD_MAX_STEP_CHARS || '120', 10) || 120;
const MAX_PASSO_PALAVRAS =
  Number.parseInt(process.env.BDD_MAX_STEP_WORDS || '18', 10) || 18;

/** Título/Funcionalidade/Cenário: só normaliza — nunca trunca. */
function normalizarTitulo(texto) {
  return limparMarkdownCru(stripTextoAdministrativo(String(texto || '')))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncamento só para corpo de passo (Quando/E/Então), não para títulos. */
function truncarSemCortar(texto, max = 120, min = 28) {
  const t = limparTexto(texto);
  if (!t || t.length <= max) return t;
  const base = t.slice(0, max);
  const ultSep = Math.max(base.lastIndexOf(' '), base.lastIndexOf(','), base.lastIndexOf(';'));
  const corte = ultSep > min ? base.slice(0, ultSep) : base;
  return `${corte.trim()}…`;
}

function limparMarkdownCru(texto) {
  return String(texto || '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Máximo de linhas "E" por cenário (padrão 3: 1 Quando + até 3 E). */
function maxEPorCenario() {
  const n = Number.parseInt(process.env.BDD_MAX_E_STEPS || '3', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 4) : 3;
}

/** Teto de linhas E no cenário inteiro (Dado + Quando); padrão = maxEPorCenario(). */
function maxTotalEPorCenario() {
  const n = Number.parseInt(process.env.BDD_MAX_TOTAL_E_STEPS || '', 10);
  if (Number.isFinite(n) && n >= 2) return Math.min(n, 8);
  return maxEPorCenario();
}

/** Ações brutas por cenário antes de resumir (evita "parte 2" desnecessária). */
function maxAcoesBrutasPorCenario() {
  const n = Number.parseInt(process.env.BDD_MAX_ACOES_POR_CENARIO || '8', 10);
  return Number.isFinite(n) && n >= 4 ? Math.min(n, 12) : 8;
}

function passoEhPlaceholder(texto) {
  const t = limparTexto(texto).toLowerCase();
  return (
    /^passo\s*\d+$/i.test(t) ||
    /^step\s*\d+$/i.test(t) ||
    /^ação\s*\d+$/i.test(t) ||
    t === 'passo' ||
    t === 'ação'
  );
}

function dedupeAcoes(acoes) {
  const out = [];
  const seen = new Set();
  for (const a of acoes) {
    const key = a.toLowerCase().replace(/\s+/g, ' ').slice(0, 72);
    if (!key || seen.has(key)) continue;
    const dup = out.some(
      (o) => o.includes(key) || key.includes(o.toLowerCase().slice(0, 40))
    );
    if (dup) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

/**
 * Resume várias micro-ações em até maxSlots passos objetivos (1 Quando + E…).
 */
function resumirGrupoAcoes(slice) {
  const joined = slice.join(' ').toLowerCase();

  if (/compar|sincron|consist|protocolo|entre\s+(sistemas|telas|portal|worklist)/i.test(joined)) {
    return (
      objetivarFrase('o usuário compara o mesmo dado entre os sistemas do fluxo', 90) ||
      'o usuário valida consistência dos dados entre telas'
    );
  }
  if (/filtro|pesquisa|busca|localiz|lista|worklist|grid/i.test(joined)) {
    return (
      objetivarFrase('o usuário localiza o registro na listagem do chamado', 90) ||
      'o usuário encontra o registro na listagem'
    );
  }
  if (/login|acessa|entra|abre\s+(o\s+)?(módulo|tela|portal)/i.test(joined)) {
    return (
      objetivarFrase('o usuário acessa a tela do fluxo descrito no chamado', 90) ||
      'o usuário acessa a funcionalidade do chamado'
    );
  }
  if (/salv|cadastr|confirm|envia|preenche|formul/i.test(joined)) {
    return (
      objetivarFrase('o usuário preenche e confirma os dados do fluxo', 90) ||
      'o usuário conclui o preenchimento e confirma'
    );
  }
  if (/valid|verific|confer|mensagem|erro|exibe/i.test(joined)) {
    return (
      objetivarFrase('o usuário verifica o resultado exibido na tela', 90) ||
      'o usuário confere o resultado na tela'
    );
  }

  const verbos = slice
    .map((s) => s.replace(/^o usuário\s+/i, '').trim())
    .filter((s) => s.length > 2 && !passoEhPlaceholder(s));
  if (verbos.length === 1) return verbos[0].startsWith('o usuário') ? verbos[0] : `o usuário ${verbos[0]}`;
  if (verbos.length >= 2) {
    const resumo = `o usuário ${verbos[0]}, depois ${verbos.slice(1, 2).join(' e ')}`;
    return objetivarFrase(resumo, 95) || limitarPalavras(resumo, MAX_PASSO_PALAVRAS);
  }

  return (
    objetivarFrase('o usuário executa o fluxo principal descrito no chamado', 90) ||
    'o usuário executa o fluxo principal do chamado'
  );
}

function consolidarAcoesObjetivas(acoes, maxSlots) {
  const limpas = dedupeAcoes(
    acoes.filter((a) => a && !passoEhPlaceholder(a))
  );

  if (!limpas.length) {
    return ['o usuário executa o fluxo descrito no chamado'];
  }
  if (limpas.length <= maxSlots) return limpas;

  const out = [];
  const porGrupo = Math.ceil(limpas.length / maxSlots);
  for (let i = 0; i < limpas.length && out.length < maxSlots; i += porGrupo) {
    const slice = limpas.slice(i, i + porGrupo);
    out.push(slice.length === 1 ? slice[0] : resumirGrupoAcoes(slice));
  }
  return dedupeAcoes(out.slice(0, maxSlots));
}

/** Converte ações resumidas em Quando + E (ordem preservada). */
function acoesParaLinhasGherkin(acoes) {
  if (!acoes.length) return [];
  const linhas = [`  Quando ${acoes[0]}`];
  for (let i = 1; i < acoes.length; i += 1) {
    linhas.push(`    E ${acoes[i]}`);
  }
  return linhas;
}

function isLinhaE(linha) {
  const t = String(linha || '');
  return /^\s+E\s+/i.test(t) && !/^\s*Então/i.test(t);
}

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

/** Nome da funcionalidade (módulo + fluxo), sem truncar. */
function nomeFuncionalidadeCurto(titulo) {
  const t = stripTextoAdministrativo(String(titulo || ''));
  if (!t) return 'Funcionalidade do chamado';

  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  if (partes.length >= 2) {
    const mod = normalizarTitulo(partes[0].replace(/^\[?\s*FEATURE\s*\]?\s*/i, ''));
    const fluxo = normalizarTitulo(partes.slice(1).join(' — '));
    return fluxo ? `${mod} — ${fluxo}` : mod;
  }

  return normalizarTitulo(t);
}

/** Transforma resultado esperado/obtido em frase verificável para Então. */
function entaoVerificavel(texto) {
  let t = limparMarkdownCru(stripTextoAdministrativo(texto));
  if (!t) return '';

  const partes = t
    .split(/[\n;]+/)
    .map((p) => limparTexto(p))
    .filter(Boolean);
  t = partes[0] || primeiraFrase(t) || t;

  t = t
    .replace(/^é\s+exibid[oa]\s+(a\s+)?mensagem\s*:?\s*/i, 'exibe a mensagem ')
    .replace(/^deve\s+ser\s+/i, 'é ')
    .replace(/^deve\s+/i, '')
    .replace(/^deverá\s+/i, '')
    .replace(/^o\s+sistema\s+deve\s+/i, '')
    .replace(/^o\s+sistema\s+/i, '')
    .trim();

  t = objetivarFrase(t, 150);
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
  if (t.length > MAX_PASSO_CHARS * 2.1) return true;
  const palavras = t.split(/\s+/).length;
  if (palavras > MAX_PASSO_PALAVRAS + 10) return true;
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
    f = truncarSemCortar(f, maxLen, 24);
  }

  f = f.replace(/[.!?]+$/g, '').trim();
  if (!f || passoEhColagemDescricao(f)) return '';
  const primeira = f.split(/\s+/)[0] || '';
  if (/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}$/.test(primeira)) return f;
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
  if (prefix === 'E') {
    const eCorpo = /^o\s+usu[aá]rio\s+/i.test(corpo) ? corpo : `o usuário ${corpo}`;
    return `    E ${eCorpo}`;
  }
  if (prefix === 'Dado que') return `  Dado que ${corpo}`;
  if (prefix === 'Quando') {
    let q = /^o\s+usu[aá]rio\s+/i.test(corpo) ? corpo : `o usuário ${corpo}`;
    q = q
      .replace(/\bo usuário\s+envio\b/i, 'o usuário envia')
      .replace(/\bo usuário\s+gravo\b/i, 'o usuário grava')
      .replace(/\bo usuário\s+abro\b/i, 'o usuário abre')
      .replace(/\bo usuário\s+comparo\b/i, 'o usuário compara')
      .replace(/\bo usuário\s+aguardo\b/i, 'o usuário aguarda')
      .replace(/\bo usuário\s+adicionar\b/i, 'o usuário adiciona');
    return `  Quando ${q}`;
  }
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
 * Divide passos em chunks: cada um com 1 Quando + até maxE linhas "E".
 * @param {string} passos
 * @param {{ maxE?: number }} [opts]
 * @returns {string[][]}
 */
function passosParaStepsGherkinComContinuacao(passos, opts = {}) {
  const maxE = opts.maxE ?? maxEPorCenario();
  const maxSlots = 1 + maxE;
  const janela = opts.janela ?? maxAcoesBrutasPorCenario();
  const partes = extrairPassosDoTexto(passos);
  const brutas = [];

  for (const p of partes) {
    if (linhaEhRotuloChamado(p) || passoEhPlaceholder(p)) continue;
    const corpo = objetivarFrase(p);
    if (!corpo || linhaEhRotuloChamado(corpo)) continue;
    brutas.push(corpo);
  }

  if (!brutas.length) return [];

  const soPlaceholder =
    partes.length > 0 && partes.every((p) => passoEhPlaceholder(p) || linhaEhRotuloChamado(p));
  const acoesFonte = soPlaceholder
    ? ['o usuário executa o fluxo descrito no chamado']
    : brutas;

  const chunks = [];
  for (let i = 0; i < acoesFonte.length; i += janela) {
    const fatia = acoesFonte.slice(i, i + janela);
    const resumidas = consolidarAcoesObjetivas(fatia, maxSlots);
    chunks.push(acoesParaLinhasGherkin(resumidas));
  }
  return chunks;
}

/**
 * Primeiro chunk de passos (Quando + até maxE "E").
 * @param {string} passos
 * @param {{ maxLinhas?: number, maxE?: number }} [opts]
 */
function passosParaStepsGherkin(passos, opts = {}) {
  const maxLinhas =
    opts.maxLinhas ??
    (Number.parseInt(process.env.BDD_MAX_PASSO_LINES || '4', 10) || 4);
  const chunks = passosParaStepsGherkinComContinuacao(passos, opts);
  const first = chunks[0] || [];
  return first.slice(0, maxLinhas);
}

/**
 * Separa corpo do cenário (sem título) em blocos Dado / ação / Então.
 */
function separarTiposLinhas(linhas) {
  const dado = [];
  const acao = [];
  let entao = null;
  let mas = null;
  let viuQuando = false;

  for (const ln of linhas || []) {
    const t = String(ln || '').trimEnd();
    if (!t) continue;
    if (/^\s*Dado/i.test(t)) {
      dado.push(t.replace(/^\s*/, (m) => (m.length >= 2 ? '  ' : '  ')));
      continue;
    }
    if (/^\s*Então/i.test(t)) {
      entao = t.startsWith('  ') ? t : `  ${t.trim()}`;
      continue;
    }
    if (/^\s*Mas/i.test(t)) {
      mas = t.startsWith('  ') ? t : `    ${t.trim()}`;
      continue;
    }
    if (/^\s*Quando/i.test(t)) {
      viuQuando = true;
      acao.push(t.startsWith('  ') ? t : `  ${t.trim()}`);
      continue;
    }
    if (isLinhaE(t)) {
      const norm = t.startsWith('    ') ? t : `    E ${t.replace(/^\s*E\s+/i, '').trim()}`;
      if (!viuQuando && !acao.length) dado.push(norm);
      else acao.push(norm);
      continue;
    }
    if (!viuQuando && !acao.length) dado.push(t);
    else acao.push(t);
  }

  return { dado, acao, entao, mas };
}

function dividirAcaoEmChunks(acaoLinhas, maxE) {
  const textos = [];
  for (const ln of acaoLinhas || []) {
    const m = String(ln).match(/^\s*(?:Quando|E)\s+(.+)$/i);
    if (m && m[1] && !passoEhPlaceholder(m[1])) textos.push(m[1].trim());
  }
  if (!textos.length) return [];

  const maxSlots = 1 + maxE;
  const janela = maxAcoesBrutasPorCenario();
  const chunks = [];
  for (let i = 0; i < textos.length; i += janela) {
    const resumidas = consolidarAcoesObjetivas(textos.slice(i, i + janela), maxSlots);
    chunks.push(acoesParaLinhasGherkin(resumidas));
  }
  return chunks;
}

function contarLinhasE(linhas) {
  return (linhas || []).filter((ln) => isLinhaE(ln)).length;
}

function extrairTextosPassosDeLinhas(linhas) {
  const textos = [];
  for (const ln of linhas || []) {
    if (/^\s*Dado/i.test(ln)) continue;
    const m = String(ln).match(/^\s*(?:Quando|E)\s+(.+)$/i);
    if (m && m[1] && !passoEhPlaceholder(m[1])) textos.push(m[1].trim());
  }
  return textos;
}

function primeiraLinhaDado(linhas) {
  return (linhas || []).find((ln) => /^\s*Dado/i.test(ln)) || null;
}

function labelAmbienteDeDado(linhaDado) {
  const m = String(linhaDado || '').match(/acessa\s+o\s+ambiente\s+(.+?)\s*$/i);
  if (m && m[1]) return normalizarTitulo(m[1]).slice(0, 48);
  return '';
}

function dadoContinuacaoFluxo() {
  return '  Dado que os passos preparatórios do cenário foram executados';
}

/**
 * Comentário Gherkin ligando cenário QA ao teste Dev / parte do fluxo.
 * @param {string} [refDev]
 * @param {{ parte?: number, fase?: string }} [meta]
 * @returns {string[]}
 */
function comentarioRefCobertura(refDev, meta = {}) {
  if (process.env.BDD_COBERTURA_REF === '0') return [];
  const linhas = [];
  if (refDev && limparTexto(refDev)) {
    linhas.push(`# Cobertura Dev: ${normalizarTitulo(refDev)}`);
  }
  if (meta.fase) linhas.push(`# Fase: ${meta.fase}`);
  if (meta.parte && meta.parte > 1) linhas.push(`# Parte ${meta.parte}`);
  return linhas;
}

function montarBlocoCenario(tituloBase, corpo, opts = {}) {
  const { refDev, parte, fase } = opts;
  return [
    `Cenário: ${tituloBase}`,
    ...comentarioRefCobertura(refDev, { parte, fase }),
    ...corpo,
  ];
}

/**
 * Divide cenário com 2+ blocos "Dado … acessa o ambiente" (integração worklist×portal).
 * @returns {string[][]|null}
 */
function dividirCenarioPorFasesAmbiente(tituloBase, linhasCorpo, opts = {}) {
  const { dado, acao, entao, mas } = separarTiposLinhas(linhasCorpo);
  const todas = [...dado, ...acao];
  const indices = [];
  todas.forEach((ln, i) => {
    if (/^\s*Dado\s+que.*acessa\s+o\s+ambiente/i.test(ln)) indices.push(i);
  });
  if (indices.length < 2) return null;

  const fases = [];
  for (let f = 0; f < indices.length; f++) {
    const start = indices[f];
    const end = f + 1 < indices.length ? indices[f + 1] : todas.length;
    fases.push(todas.slice(start, end));
  }

  const maxE = maxEPorCenario();
  const maxSlots = 1 + maxE;
  const janela = maxAcoesBrutasPorCenario();
  const blocos = [];

  for (let f = 0; f < fases.length; f++) {
    const faseLinhas = fases[f];
    const dadoAmb = primeiraLinhaDado(faseLinhas);
    const faseLabel = labelAmbienteDeDado(dadoAmb) || `fase ${f + 1}`;
    const textos = extrairTextosPassosDeLinhas(faseLinhas);
    const prefixoDado =
      f === 0 ? (dadoAmb ? [dadoAmb] : []) : [dadoContinuacaoFluxo(), ...(dadoAmb ? [dadoAmb] : [])];

    if (!textos.length) {
      blocos.push({
        titulo: `${tituloBase} — ${faseLabel}`,
        corpo: [...prefixoDado, '  Quando o usuário executa o fluxo descrito no chamado'],
        fase: faseLabel,
        parte: f + 1,
        ultimo: f === fases.length - 1,
      });
      continue;
    }

    for (let i = 0; i < textos.length; i += janela) {
      const resumidas = consolidarAcoesObjetivas(
        textos.slice(i, i + janela),
        maxSlots
      );
      const acaoGherkin = acoesParaLinhasGherkin(resumidas);
      const parteFluxo = Math.floor(i / janela) + 1;
      const suffixCont =
        textos.length > janela && parteFluxo > 1 ? ' — continuação' : '';
      blocos.push({
        titulo: `${tituloBase} — ${faseLabel}${suffixCont}`,
        corpo: [...(i === 0 ? prefixoDado : [dadoContinuacaoFluxo()]), ...acaoGherkin],
        fase: faseLabel,
        parte: blocos.length + 1,
        ultimo: f === fases.length - 1 && i + janela >= textos.length,
      });
    }
  }

  if (blocos.length <= 1) return null;

  const ultimoIdx = blocos.length - 1;
  return blocos.map((b, idx) => {
    const corpo = [...b.corpo];
    if (idx === ultimoIdx) {
      if (entao) corpo.push(entao);
      if (mas) corpo.push(mas);
    }
    return montarBlocoCenario(b.titulo, corpo, {
      refDev: opts.refDev,
      parte: b.parte,
      fase: b.fase,
    });
  });
}

/**
 * Divide passos (Dado E + Quando/E) em cenários menores respeitando maxE.
 * @returns {string[][]}
 */
function dividirCenarioPorTotalPassos(tituloBase, dado, acao, entao, mas, opts = {}) {
  const maxE = maxEPorCenario();
  const maxSlots = 1 + maxE;
  const janela = maxAcoesBrutasPorCenario();
  const dadoAmb = primeiraLinhaDado(dado);
  const textos = [
    ...extrairTextosPassosDeLinhas(dado),
    ...extrairTextosPassosDeLinhas(acao),
  ];

  if (!textos.length) {
    const corpo = [
      ...(dadoAmb ? [dadoAmb] : dado),
      '  Quando o usuário executa o fluxo descrito no chamado',
    ];
    if (entao) corpo.push(entao);
    if (mas) corpo.push(mas);
    return [montarBlocoCenario(tituloBase, corpo, opts)];
  }

  const partes = [];
  for (let i = 0; i < textos.length; i += janela) {
    const resumidas = consolidarAcoesObjetivas(
      textos.slice(i, i + janela),
      maxSlots
    );
    partes.push(acoesParaLinhasGherkin(resumidas));
  }

  if (partes.length <= 1) {
    const corpo = [...(dadoAmb ? [dadoAmb] : dado), ...partes[0]];
    if (entao) corpo.push(entao);
    if (mas) corpo.push(mas);
    return [montarBlocoCenario(tituloBase, corpo, opts)];
  }

  return partes.map((acaoPart, idx) => {
    const suffix = idx > 0 ? ' — continuação' : '';
    const prefixo =
      idx === 0
        ? dadoAmb
          ? [dadoAmb]
          : dado.filter((ln) => /^\s*Dado/i.test(ln))
        : [dadoContinuacaoFluxo()];
    const corpo = [...prefixo, ...acaoPart];
    const ultimo = idx === partes.length - 1;
    if (ultimo && entao) corpo.push(entao);
    if (ultimo && mas) corpo.push(mas);
    return montarBlocoCenario(`${tituloBase}${suffix}`, corpo, {
      ...opts,
      parte: idx + 1,
    });
  });
}

/**
 * Divide um cenário quando há mais de maxE linhas "E" (inclui E sob Dado).
 * @param {string} tituloBase
 * @param {string[]} linhasCorpo
 * @param {{ refDev?: string }} [opts]
 * @returns {string[][]}
 */
function dividirCenarioCompletoPorMaxE(tituloBase, linhasCorpo, opts = {}) {
  const maxE = maxEPorCenario();
  const maxTotal = maxTotalEPorCenario();
  const { dado, acao, entao, mas } = separarTiposLinhas(linhasCorpo);

  const porFases = dividirCenarioPorFasesAmbiente(tituloBase, linhasCorpo, opts);
  if (porFases) return porFases;

  const totalE = contarLinhasE(dado) + contarLinhasE(acao);
  const textosAcao = extrairTextosPassosDeLinhas(acao);
  const janela = maxAcoesBrutasPorCenario();

  if (!textosAcao.length && totalE <= maxTotal) {
    const corpo = [
      ...dado,
      '  Quando o usuário executa o fluxo descrito no chamado',
    ];
    if (entao) corpo.push(entao);
    if (mas) corpo.push(mas);
    return [montarBlocoCenario(tituloBase, corpo, opts)];
  }

  if (totalE > maxTotal || textosAcao.length > janela) {
    return dividirCenarioPorTotalPassos(tituloBase, dado, acao, entao, mas, opts);
  }

  const maxSlots = 1 + maxE;
  const partesAcao = [];
  if (textosAcao.length <= janela) {
    partesAcao.push(
      acoesParaLinhasGherkin(consolidarAcoesObjetivas(textosAcao, maxSlots))
    );
  } else {
    for (let i = 0; i < textosAcao.length; i += janela) {
      partesAcao.push(
        acoesParaLinhasGherkin(
          consolidarAcoesObjetivas(textosAcao.slice(i, i + janela), maxSlots)
        )
      );
    }
  }

  if (partesAcao.length === 1 && totalE <= maxTotal) {
    const corpo = [...dado, ...partesAcao[0]];
    if (entao) corpo.push(entao);
    if (mas) corpo.push(mas);
    return [montarBlocoCenario(tituloBase, corpo, opts)];
  }

  return partesAcao.map((acaoPart, idx) => {
    const suffix = idx > 0 ? ' — continuação' : '';
    const dadoAmb = primeiraLinhaDado(dado);
    const prefixo = idx === 0 ? (dadoAmb ? [dadoAmb] : []) : [dadoContinuacaoFluxo()];
    const corpo = [...prefixo, ...acaoPart];
    const ultimo = idx === partesAcao.length - 1;
    if (ultimo && entao) corpo.push(entao);
    if (ultimo && mas) corpo.push(mas);
    return montarBlocoCenario(`${tituloBase}${suffix}`, corpo, {
      ...opts,
      parte: idx + 1,
    });
  });
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

  const porMarkdown = parseCenariosDevMarkdown(bruto);
  if (porMarkdown && porMarkdown.length) return porMarkdown;

  const porNumero = bruto.split(/(?=^\s*\d+\s*(?:[-–—.)]+)\s)/m).filter((c) => limparTexto(c));
  if (porNumero.length > 1) {
    return porNumero.map((chunk, i) => parseDevChunk(chunk, `Passo ${i + 1}`));
  }

  return [parseDevChunk(bruto, null)];
}

function limparLabelMarkdown(label) {
  return limparMarkdownCru(String(label || ''))
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^[\s:'"]+|[\s:'"]+$/g, '')
    .trim();
}

/** Label + descrição de bullet markdown Dev (`**Rota** POST ...: cond → 403`). */
function extrairLabelDescricaoBullet(bullet) {
  const b = limparMarkdownCru(String(bullet || ''));

  const mTickInBold = b.match(/^\*\*`([^`]+)`:\*+\s*(.*)$/s);
  if (mTickInBold) {
    return {
      label: limparLabelMarkdown(mTickInBold[1]),
      descricao: limparMarkdownCru(mTickInBold[2]),
    };
  }

  const mBold = b.match(/^\*\*([^*:]+):\*+\s*(.*)$/s);
  if (mBold) {
    let label = limparLabelMarkdown(mBold[1]);
    let descricao = limparMarkdownCru(mBold[2]);
    if (descricao.startsWith('`')) {
      const route = descricao.match(/^`([^`]+)`\s*:?\s*(.*)$/s);
      if (route) {
        label = normalizarTitulo(`${label} ${route[1]}`);
        descricao = route[2].trim();
      }
    }
    return { label, descricao };
  }

  const mTick = b.match(/^`([^`]+)`\s*:+\s*(.*)$/s);
  if (mTick) {
    return { label: limparLabelMarkdown(mTick[1]), descricao: limparMarkdownCru(mTick[2]) };
  }

  const colon = b.search(/:(?![^`]*`)/);
  if (colon > 2 && colon < 90) {
    return {
      label: limparLabelMarkdown(b.slice(0, colon)),
      descricao: limparMarkdownCru(b.slice(colon + 1)),
    };
  }

  return { label: limparLabelMarkdown(b), descricao: limparMarkdownCru(b) };
}

/** Pares condição → resultado dentro do bullet (separados por `;`). */
function extrairParesSeta(descricao) {
  const pares = [];
  const partes = String(descricao || '')
    .split(/\s*;\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const p of partes) {
    const m = p.match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
    if (m) {
      pares.push({
        acao: m[1].replace(/`/g, '').trim(),
        resultado: m[2].replace(/`/g, '').trim(),
      });
    }
  }
  if (!pares.length) {
    const m = String(descricao || '').match(/^(.+?)\s*(?:→|->)\s*(.+)$/);
    if (m) {
      pares.push({
        acao: m[1].replace(/`/g, '').trim(),
        resultado: m[2].replace(/`/g, '').trim(),
      });
    }
  }
  return pares;
}

function entaoDeResultadoMarkdown(resultado) {
  const r = String(resultado || '').trim();
  if (/^\d{3}$/.test(r)) return `a API retorna status HTTP ${r}`;
  if (/^2\d{2}$/.test(r)) return `a API retorna sucesso (HTTP ${r})`;
  const ev = entaoVerificavel(r);
  return ev || objetivarFrase(r, 110) || r;
}

function quandoDeAcaoMarkdown(acao, label, bullet) {
  const a = String(acao || '').trim();
  const ctx = `${label} ${bullet}`;
  if (/POST|GET|PUT|PATCH|DELETE|\/[a-z]/i.test(ctx)) {
    const prep = objetivarFrase(a, 80) || a;
    return `  Quando o usuário realiza a requisição com ${prep}`;
  }
  if (/aba|portal|frontend|tela|relatório|unidade|meus exames/i.test(ctx)) {
    const prep = objetivarFrase(a, 80) || a;
    return `  Quando o usuário ${prep}`;
  }
  const prep = objetivarFrase(a, 85) || a;
  return `  Quando o usuário ${prep}`;
}

function montarCorpoBulletMarkdown(label, descricao, bullet) {
  const descCurta = limparMarkdownCru(String(descricao || '').split(';')[0] || descricao);
  const pares = extrairParesSeta(descricao);
  if (pares.length) {
    return pares.map(({ acao, resultado }) => {
      const quando = quandoDeAcaoMarkdown(acao, label, bullet);
      const entao = `  Então ${entaoDeResultadoMarkdown(resultado)}`;
      return { quando, entao, sufixo: limparMarkdownCru(acao) };
    });
  }

  if (/retorna|exibe|mantém|continua|consome|valida|não deve|sem erro|403|400|200|timeout|chunking/i.test(descricao)) {
    let quando;
    if (/^(enviados|recebidos|todos)$/i.test(label)) {
      quando = `  Quando o usuário consulta exames com filtro compartilhamento ${label}`;
    } else if (/POST|GET|PUT|PATCH|DELETE|rota|endpoint/i.test(bullet)) {
      quando = `  Quando o usuário consulta o endpoint ${label}`;
    } else if (/performance|timeout|chunking/i.test(label + descricao)) {
      quando = `  Quando o usuário consulta relatório com período amplo e alto volume`;
    } else if (/aba|portal|frontend|tela|relatório|unidade:|meus exames/i.test(bullet)) {
      quando = `  Quando o usuário acessa ${label} no portal`;
    } else if (/atenção|ignorado|inválido/i.test(label + descricao)) {
      quando = `  Quando o usuário consulta Meus Exames com parâmetro inválido de compartilhamento`;
    } else {
      quando = `  Quando o usuário valida ${label}`;
    }
    const ev = entaoVerificavel(descCurta) || objetivarFrase(descCurta, 120);
    return [{ quando, entao: `  Então ${ev || descricao}`, sufixo: '' }];
  }

  const prep = objetivarFrase(descricao, 90) || descricao;
  return [
    {
      quando: `  Quando o usuário ${prep}`,
      entao: null,
      sufixo: '',
    },
  ];
}

/** Bullets de Dev que não viram cenário QA manual (CI, automação). */
function bulletEhSomenteMetaDev(bullet) {
  const b = String(bullet || '').toLowerCase();
  return (
    /^\*\*automa/.test(bullet) ||
    /\btestes?\s+unit[aá]rios?\b/.test(b) ||
    /\bcomplementar\s+com\s+testes\s+http/i.test(b) ||
    /\b\d+\s+testes?\s+unit/i.test(b)
  );
}

/**
 * Cenários Dev em markdown (### seção + bullets), comum em cards de feature.
 */
function parseCenariosDevMarkdown(bruto) {
  if (!/^#{1,3}\s+/m.test(bruto)) return null;

  const sections = bruto.split(/(?=^#{1,3}\s+)/m).filter((c) => limparTexto(c));
  if (!sections.length) return null;

  const blocos = [];

  for (const section of sections) {
    const lines = section.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const head = lines.find((l) => /^#{1,3}\s+/.test(l));
    const sectionTitle = head
      ? head.replace(/^#{1,3}\s+/, '').trim()
      : 'Cenários Dev';

    const bullets = lines
      .filter((l) => /^[-*]\s+/.test(l))
      .map((l) => l.replace(/^[-*]\s+/, '').trim())
      .filter((b) => b.length >= 12);

    if (!bullets.length) {
      blocos.push(parseDevChunk(section, sectionTitle));
      continue;
    }

    for (const bullet of bullets) {
      if (bulletEhSomenteMetaDev(bullet)) continue;
      const { label, descricao } = extrairLabelDescricaoBullet(bullet);
      const tituloBase = label || sectionTitle;
      const corpos = montarCorpoBulletMarkdown(label, descricao, bullet);

      for (const { quando, entao, sufixo } of corpos) {
        if (!entao) continue;
        const tituloCurto = sufixo
          ? normalizarTitulo(`${tituloBase} — ${sufixo}`)
          : normalizarTitulo(tituloBase);
        const qLine = String(quando || '').replace(/^\s+/, '').trim();
        const eLine = String(entao || '').replace(/^\s+/, '').trim();
        const corpo = `${qLine}\n${eLine}`;
        blocos.push(
          parseDevChunk(
            `Cenário: ${sectionTitle} — ${tituloCurto}\n${corpo}`,
            `${sectionTitle} — ${tituloCurto}`
          )
        );
      }
    }
  }

  return blocos.length ? blocos : null;
}

/** Quando/Então já escritos no corpo do bloco Dev (parse markdown). */
function extrairQuandoEntaoDoCorpo(body) {
  const lines = String(body || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let quando = null;
  let entao = null;
  for (const l of lines) {
    const mq = l.match(/^quando\s+(.+)$/i);
    if (mq) {
      const norm = normalizarLinhaGherkin(`Quando ${mq[1]}`);
      quando = norm || passoGherkin('Quando', mq[1]);
    }
    const me = l.match(/^ent[aã]o\s+(.+)$/i);
    if (me) {
      const norm = normalizarLinhaGherkin(`Então ${me[1]}`);
      entao = norm || (entaoVerificavel(me[1]) ? `  Então ${entaoVerificavel(me[1])}` : null);
    }
  }
  return { quando, entao };
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
 * Cenários QA a partir de um bloco Dev (divide se passar de maxE linhas "E").
 * @returns {string[][]}
 */
function cenariosQaAPartirDoDev(bloco, ctx, nomeFuncionalidade) {
  const titulo = bloco.title
    ? normalizarTitulo(bloco.title)
    : `${nomeFuncionalidadeCurto(nomeFuncionalidade)} — validação`;
  const refDev = bloco.title || null;

  const passosCorpo = extrairQuandoEntaoDoCorpo(bloco.body);
  if (passosCorpo.quando && passosCorpo.entao) {
    return dividirCenarioCompletoPorMaxE(
      titulo,
      [...montarDadosIniciais(ctx), passosCorpo.quando, passosCorpo.entao],
      { refDev }
    );
  }

  const { entaoParaBlocoDev } = require('./bdd-rigor');
  let entao =
    entaoParaBlocoDev(ctx, bloco.body) || entaoDoContexto(ctx, bloco.body);
  if (!entao) return [];

  const gherkinDev = extrairLinhasGherkinDoBloco(bloco.lines);
  if (gherkinDev.length >= 2) {
    const corpo = [...montarDadosIniciais(ctx)];
    for (const ln of gherkinDev) {
      if (/^\s*Dado/i.test(ln)) continue;
      corpo.push(ln);
    }
    if (!gherkinDev.some((l) => /^\s*Então/i.test(l))) {
      corpo.push(entao);
    }
    return dividirCenarioCompletoPorMaxE(titulo, corpo, { refDev });
  }

  const passosMerged =
    bloco.body && limparTexto(bloco.body)
      ? mergePassosFontes(
          bloco.body,
          onlyTitleAndDevSources() ? '' : ctx.passos
        )
      : onlyTitleAndDevSources()
        ? ''
        : mergePassosFontes(ctx.passos, ctx.descricao);

  const chunks = passosParaStepsGherkinComContinuacao(passosMerged);
  if (!chunks.length) {
    const { quandoSubstituto } = require('./bdd-rigor');
    const quando = passosCorpo.quando || quandoSubstituto(ctx);
    if (!quando) return [];
    return dividirCenarioCompletoPorMaxE(
      titulo,
      [...montarDadosIniciais(ctx), quando, entao],
      { refDev }
    );
  }

  return chunks.flatMap((passos, idx) => {
    const suffix = idx > 0 ? ` — continuação` : '';
    const corpo = [...montarDadosIniciais(ctx), ...passos];
    if (idx === chunks.length - 1) corpo.push(entao);
    return dividirCenarioCompletoPorMaxE(`${titulo}${suffix}`, corpo, {
      refDev,
      parte: idx + 1,
    });
  });
}

/** Um único cenário (primeiro bloco) — compatibilidade. */
function cenarioQaAPartirDoDev(bloco, ctx, nomeFuncionalidade) {
  return cenariosQaAPartirDoDev(bloco, ctx, nomeFuncionalidade)[0] || [];
}

function entaoDoContexto(ctx, textoDevFallback = '') {
  if (process.env.BDD_ASSERTIVE_MODE !== '0') {
    const { entaoAssertivoDoContexto } = require('./bdd-validacoes');
    return entaoAssertivoDoContexto(ctx, textoDevFallback);
  }
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
  return null;
}

/**
 * Cenário principal QA a partir da descrição e passos da tarefa (sem bloco Dev).
 */
function cenariosPrincipalNgf(ctx, nomeFuncionalidade) {
  const nomeCurto = nomeFuncionalidadeCurto(nomeFuncionalidade);
  const titulo = `${nomeCurto} — validação principal`;
  const entao = entaoDoContexto(ctx);
  if (!entao) return [];
  const chunks = passosParaStepsGherkinComContinuacao(resolverPassosReproducao(ctx));

  if (!chunks.length) {
    const { quandoSubstituto } = require('./bdd-rigor');
    const quando = quandoSubstituto(ctx);
    if (!quando || !entao) return [];
    return dividirCenarioCompletoPorMaxE(titulo, [
      ...montarDadosIniciais(ctx),
      quando,
      entao,
    ]);
  }

  return chunks.map((passos, idx) => {
    const suffix = idx > 0 ? ` — continuação` : '';
    const linhas = [`Cenário: ${titulo}${suffix}`, ...montarDadosIniciais(ctx), ...passos];
    if (idx === chunks.length - 1) linhas.push(entao);
    return linhas;
  });
}

function cenarioPrincipalNgf(ctx, nomeFuncionalidade) {
  return cenariosPrincipalNgf(ctx, nomeFuncionalidade)[0] || [];
}

/**
 * Cenário mínimo a partir do título quando não há Dev/NGF (smoke).
 */
function cenariosSmokeAPartirDoTitulo(ctx, nomeFuncionalidade) {
  const tituloCard = limparTexto(ctx.titulo) || limparTexto(nomeFuncionalidade);
  if (!tituloCard) return [];
  const nomeCurto = nomeFuncionalidadeCurto(nomeFuncionalidade);
  const tituloCenario = `${nomeCurto} — validação pelo título do chamado`;
  const entao = entaoAPartirDoTitulo(tituloCard);
  const passos = passosAPartirDoTitulo(tituloCard);
  if (!entao || !passos.length) return [];
  return [
    [`Cenário: ${tituloCenario}`, ...montarDadosIniciais(ctx), ...passos, entao],
  ];
}

/**
 * Converte bloco "Cenários de Teste (Dev)" em passos E resumidos.
 */
function devCenariosParaPassosE(texto) {
  if (!texto || !limparTexto(texto)) return [];

  const linhas = [];
  const vistos = new Set();

  const maxE = maxEPorCenario();

  for (const item of extrairPassosDoTexto(texto)) {
    if (linhas.length >= maxE) break;

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
  return [dadoAcessaAmbiente(ambiente)];
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
  const passos = ctx.passosFiltrados || ctx.passos;
  const desc = ctx.descricaoFiltrada || ctx.descricao;
  const evid = Array.isArray(ctx.passosEvidencia) ? ctx.passosEvidencia.join('\n') : '';
  const merged = mergePassosFontes(passos, evid, desc);
  if (merged) return merged;
  if (limparTexto(passos)) return passos;
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
    fluxoObj ? `  Quando ${fluxoObj}` : null,
  ].filter(Boolean);
}

function entaoAPartirDoTitulo(titulo) {
  const t = limparTexto(titulo);
  if (!t) return null;
  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  const alvo = partes.length > 1 ? partes.slice(1).join(' ') : t;
  const obj = objetivarFrase(`${alvo} funciona conforme descrito no chamado`, 90);
  if (!obj) return null;
  const { entaoEhVago } = require('./bdd-rigor');
  if (entaoEhVago(obj)) return null;
  return `  Então ${obj}`;
}

/**
 * Reorganiza cenários com mais de maxE linhas "E" em cenários de continuação.
 */
function aplicarLimiteEPorCenarioNaFeature(feature) {
  if (!feature || typeof feature !== 'string') return '';

  const linhas = feature.split(/\r?\n/);
  const header = [];
  const cenarios = [];
  let atual = null;

  for (const line of linhas) {
    const trimmed = line.trimEnd();
    if (/^cenário\s*:/i.test(trimmed)) {
      if (atual) cenarios.push(atual);
      atual = { titulo: trimmed.replace(/^cenário\s*:\s*/i, '').trim(), corpo: [] };
      continue;
    }
    if (!atual) {
      header.push(line);
      continue;
    }
    if (trimmed) atual.corpo.push(line);
  }
  if (atual) cenarios.push(atual);

  const saida = [...header];
  if (header.length && header[header.length - 1] !== '') saida.push('');

  for (const cen of cenarios) {
    const partes = dividirCenarioCompletoPorMaxE(cen.titulo, cen.corpo);
    for (const bloco of partes) {
      saida.push(...bloco, '');
    }
  }

  return saida.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Pós-processa feature inteira: encurta passos, remove colagens, limita "E".
 * @param {string} feature
 */
function sanitizarFeatureBdd(feature) {
  if (!feature || typeof feature !== 'string') return '';

  let texto = feature.replace(/^\s*E\s+cen[aá]rio\s*:/gim, 'Cenário:');
  const linhas = texto.split(/\r?\n/);
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

  return aplicarLimiteEPorCenarioNaFeature(
    out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  );
}

module.exports = {
  limparTexto,
  normalizarTitulo,
  stripTextoAdministrativo,
  linhaEhRotuloChamado,
  nomeFuncionalidadeCurto,
  entaoVerificavel,
  primeiraFrase,
  objetivarFrase,
  passoGherkin,
  passosParaStepsGherkin,
  passosParaStepsGherkinComContinuacao,
  consolidarAcoesObjetivas,
  acoesParaLinhasGherkin,
  dividirCenarioCompletoPorMaxE,
  comentarioRefCobertura,
  maxEPorCenario,
  maxTotalEPorCenario,
  extrairPassosDoTexto,
  mergePassosFontes,
  parseCenariosDevBlocos,
  cenarioQaAPartirDoDev,
  cenariosQaAPartirDoDev,
  cenarioPrincipalNgf,
  cenariosPrincipalNgf,
  cenariosSmokeAPartirDoTitulo,
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
