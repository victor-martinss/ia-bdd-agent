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
const MAX_ENTAO_CHARS =
  Number.parseInt(process.env.BDD_MAX_ENTAO_CHARS || '220', 10) || 220;
const MAX_ENTAO_DEV_CHARS =
  Number.parseInt(process.env.BDD_MAX_ENTAO_DEV_CHARS || '520', 10) || 520;
const MAX_QUANDO_DEV_CHARS =
  Number.parseInt(process.env.BDD_MAX_QUANDO_DEV_CHARS || '380', 10) || 380;

/** Terminações que indicam frase cortada no meio (sem fechamento). */
const TERMINACOES_INCOMPLETAS =
  /\b(o|a|os|as|um|uma|de|do|da|dos|das|d[oa]s|em|no|na|nos|nas|para|por|com|sem|ao|à|aos|às|após|antes|entre|sobre|durante|que|se|até|como|the|and|or|to|for|with|in|on|at|after|before)\s*$/i;

const ENTAO_INCOMPLETO_DEV =
  /\b(?:dever[aá]\s+)?ser\s+(?:retornad[oa]s?|exibid[oa]s?|enviad[oa]s?|processad[oa]s?|gerad[oa]s?)\s*$/i;

/** Detecta Então/Quando cortado, colagem ou sem fechamento. */
function fraseEhIncompleta(texto) {
  const bruto = String(texto || '');
  const t = limparTexto(bruto.replace(/^ent[aã]o\s+|^quando\s+|^e\s+o\s+usu[aá]rio\s+/i, ''));
  if (!t || t.length < 10) return true;
  if (/…|\.\.\./.test(bruto)) return true;
  if (TERMINACOES_INCOMPLETAS.test(t)) return true;
  if (ENTAO_INCOMPLETO_DEV.test(t)) return true;
  // Colagem tipo "salvaConfig" — ignora tokens PascalCase (MobileMed, iOS)
  const semMarcasPascal = t.replace(
    /\b[A-ZÁÉÍÓÚ][a-záéíóú]+[A-ZÁÉÍÓÚ][A-Za-záéíóúãõ]*\b/g,
    ' '
  );
  if (/[a-záéíóúãõ][A-ZÁÉÍÓÚ][a-záéíóú]/.test(semMarcasPascal)) return true;
  if (/\b(Salvar|Configurar|Abrir|Acessar)[a-záéíóú]/.test(t)) return true;
  if (
    t.split(/\s+/).length > 22 &&
    !/[.!?]$/.test(t) &&
    !/\bdeve(?:r[aá])?\b/i.test(t)
  ) {
    return true;
  }
  if (/\b(deve|dever[aá])\s+(validar|confirmar|salvar|exibir|criar|remover|processar)\s*$/i.test(t)) {
    return true;
  }
  if (/,\s*$/.test(t) || /^ap[oó]s\s+alguns\s+instantes,?\s*$/i.test(t)) return true;
  if (/\b(sugerindo|caso|quando|onde|enquanto)\s*$/i.test(t)) return true;
  if (/\bdeve\s*$/i.test(t) || /\bdeve\s+(ser|serem)\s*$/i.test(t)) return true;
  // Asserções Then Dev (Gherkin inglês) sem "deve"
  if (
    t.length >= 15 &&
    !TERMINACOES_INCOMPLETAS.test(t) &&
    (/^nenhum[a]?\s+.+\bgerad[oa]s?\b/i.test(t) ||
      /\bo\s+sistema\s+exibe\b/i.test(t) ||
      /\b(foi|foram)\s+ultrapassad[oa]s?\b/i.test(t) ||
      /\b(é|são)\s+gerad[oa]s?\b/i.test(t) ||
      /\bum\s+laudo\s+(é|foi)\b/i.test(t) ||
      /\bo\s+usu[aá]rio\s+pode\b/i.test(t))
  ) {
    return false;
  }
  // Pré-condições Given GWT: "está no portal", "selecionou N imagens"
  if (
    t.length >= 12 &&
    (/\best[aá]\s+(?:no|na|em|logado)\b/i.test(t) ||
      /\bselecionou\s+\d+\s+/i.test(t))
  ) {
    return false;
  }
  // Ações When Dev GWT: "clica no botão…"
  if (t.length >= 15 && /\bclica\s+(?:no|em)\s+bot[aã]o\b/i.test(t)) {
    return false;
  }
  if (
    !/\b(deve|dever[aá]|n[aã]o deve|n[aã]o pode|devem|precisa|retornar|exibir|ocorrer|ser)\b/i.test(
      t
    ) &&
    t.length < 80
  ) {
    return true;
  }
  if (/\bdeve(?:r[aá])?\b/i.test(t) && t.length >= 20 && t.length <= MAX_ENTAO_DEV_CHARS) {
    return false;
  }
  return false;
}

/** Quando colado (várias ações numa linha) ou ilegível. */
function passoEhColagemGherkin(texto) {
  const t = limparTexto(String(texto || '').replace(/^quando\s+|^e\s+/i, ''));
  if (!t) return true;
  const ehDevLongo =
    /^usu[aá]rio\b/i.test(t) ||
    /^o\s+usu[aá]rio\s+/i.test(t) ||
    /descri[cç][ãa]o\s*:|resultado\s+esperado\s*:/i.test(t) ||
    /\b(modal|permiss[aã]o|compartilh|listagem|unidade|atribui[cç][ãa]o|permissões)\b/i.test(
      t
    );
  const limiteChars = ehDevLongo
    ? MAX_QUANDO_DEV_CHARS * 1.45
    : MAX_PASSO_CHARS * 1.35;
  if (t.length > limiteChars) {
    const fraseCompleta = /[.!?]$/.test(t) && !/…|\.\.\./.test(t);
    if (!fraseCompleta) return true;
  }
  if (passoEhColagemDescricao(t)) return true;
  if (fraseEhIncompleta(t)) return true;
  return false;
}

/** Remove traços decorativos em títulos (Funcionalidade/Cenário), mantendo prosa objetiva. */
function prosaTituloSemTracos(texto) {
  if (!texto) return '';
  let t = String(texto);
  t = t
    .replace(/\s*[-–—]\s*continua[cç][aã]o/gi, ' (continuação)')
    .replace(/\s*[-–—]\s*valida[cç][aã]o(\s+principal)?/gi, (_, p) =>
      p ? ' validação principal' : ' validação'
    )
    .replace(/\s*[-–—]\s*defeito\s+observado/gi, ', defeito observado')
    .replace(/\s*[-–—]\s*respostas\s+diferentes/gi, ', respostas diferentes')
    .replace(/\s*[-–—]\s*/g, ', ')
    .replace(/,\s*,+/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/,\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}

function sufixoContinuacaoCenario(idx) {
  return idx > 0 ? ' (continuação)' : '';
}

/** Título/Funcionalidade/Cenário: só normaliza — nunca trunca. */
function normalizarTitulo(texto) {
  return prosaTituloSemTracos(
    limparMarkdownCru(stripTextoAdministrativo(String(texto || '')))
      .replace(/\s+/g, ' ')
      .trim()
  );
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
    .replace(/\[\/b\]|\[b\]/gi, '')
    .replace(/\[url\][^\[]*(?:\[\/url\])?/gi, '')
    .replace(/`/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/^--\s+/g, '')
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
    const resumo =
      verbos.length === 2
        ? `o usuário ${verbos[0]} e ${verbos[1]}`
        : `o usuário ${verbos[0]}`;
    return objetivarFrase(resumo, 95) || limitarPalavras(resumo, MAX_PASSO_PALAVRAS);
  }

  return (
    objetivarFrase('o usuário executa o fluxo principal descrito no chamado', 90) ||
    'o usuário executa o fluxo principal do chamado'
  );
}

function splitPassosColados(texto) {
  const t = limparTexto(texto);
  if (!t) return [];
  const partes = t
    .split(/\s+(?=O usuário\s|A requisição\s)/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8);
  return partes.length > 1 ? partes : [t];
}

function consolidarAcoesObjetivas(acoes, maxSlots) {
  const expandidas = [];
  for (const a of acoes || []) {
    if (!a || passoEhPlaceholder(a)) continue;
    const partes = splitPassosColados(a);
    expandidas.push(...partes);
  }
  const limpas = dedupeAcoes(expandidas);

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
function formatarCorpoAcao(corpo) {
  let c = String(corpo || '').trim();
  if (!c) return '';
  if (!/^o\s+usu[aá]rio\s+/i.test(c)) {
    c = `o usuário ${c.charAt(0).toLowerCase()}${c.slice(1)}`;
  }
  return c
    .replace(/\bo usuário\s+configura e inserir\b/i, 'o usuário configura e insere')
    .replace(/\bo usuário\s+salvar\b/i, 'o usuário salva');
}

function acoesParaLinhasGherkin(acoes) {
  if (!acoes.length) return [];
  const linhas = [`  Quando ${formatarCorpoAcao(acoes[0])}`];
  for (let i = 1; i < acoes.length; i += 1) {
    linhas.push(`    E ${formatarCorpoAcao(acoes[i])}`);
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
      /\b(tarefa\s+aberta|evid[eê]ncias?|enviadas?\s+por|solicitado\s+por|pela?\s+[\w.]+\s*NQ|inf\s+e\s+evid[eê]ncias?).*$/gi,
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
    const fluxo = normalizarTitulo(partes.slice(1).join(', '));
    if (!mod) return fluxo || normalizarTitulo(t);
    return fluxo ? `${mod}, ${fluxo}` : mod;
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
    .replace(/^n[aã]o\s+solicitar\s+/i, 'nenhuma ')
    .replace(/^n[aã]o\s+deve\s+solicitar\s+/i, 'nenhuma ')
    .replace(/^deve\s+ser\s+/i, 'é ')
    .replace(/^deve\s+/i, '')
    .replace(/^deverá\s+/i, '')
    .replace(/^o\s+sistema\s+deve\s+/i, '')
    .replace(/^o\s+sistema\s+/i, '')
    .trim();

  if (/^nenhum(a|as|os)?\s+/i.test(t) && !/\b(é|são|está|exibe|apresenta|permanece|continua|solicit)\b/i.test(t)) {
    t = t.replace(/[.!?]+$/g, '').trim();
    if (/autentic|login|sess[aã]o|credencial/i.test(t)) {
      t = `${t} é solicitada`;
    }
  }

  t = objetivarFrase(t, MAX_ENTAO_CHARS);
  if (!t) return '';

  if (fraseEhIncompleta(t)) {
    const bruto = limparMarkdownCru(stripTextoAdministrativo(texto));
    const devFull = entaoVerificavelDev(bruto);
    if (devFull && !fraseEhIncompleta(devFull)) return devFull;
    const pf = primeiraFrase(bruto);
    if (pf && pf.length > t.length) {
      const pfDev = entaoVerificavelDev(pf);
      if (pfDev && !fraseEhIncompleta(pfDev)) return pfDev;
      const pfObj = objetivarFrase(pf, MAX_ENTAO_CHARS);
      if (pfObj && !fraseEhIncompleta(pfObj)) t = pfObj;
    }
  }

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
    /^(informa|clica|acessa|envia|visualiza|visualizo|preenche|seleciona|seleciono|abre|cadastra|exporta|tenta|valida|confirma|realiza|inicia|sai|alterna|fecha|entra|configura|cria|aguarda|compara|verifica|anota|aplica|registra|carrega|carrego|filtra|filtro|abre|selecionar|configurar|criar|aguardar|comparar|verificar|anotar|aplicar|registrar|cadastrar|enviar|clicar|informar|acessar|visualizar|preencher|abrir|exportar|validar|confirmar|iniciar|sair|alternar|fechar|entrar|realizar)/i;
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
    if (!/^o usuário\s/i.test(f) && !/^usu[aá]rios?\b/i.test(f)) {
      f = `o usuário ${f.charAt(0).toLowerCase()}${f.slice(1)}`;
    }
  }

  if (
    /^(está|esta|são|é|existem|há|permanece|continua)/i.test(f) &&
    !/^o\s+usuário/i.test(f)
  ) {
    if (/^exist(em|e)\s/i.test(f)) {
      /* pré-condição: "E existe/existem …" — sem prefixo o usuário */
    } else {
      f = `o usuário ${f.charAt(0).toLowerCase()}${f.slice(1)}`;
    }
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
    let eCorpo = corpo;
    if (
      !/^(o|a|os|as|sou|estou|existem|existe|gerencio|há)\s/i.test(eCorpo) &&
      !/^o\s+usu[aá]rio\s+/i.test(eCorpo) &&
      !/^a\s+tarefa\b/i.test(eCorpo)
    ) {
      eCorpo = `o usuário ${eCorpo}`;
    }
    eCorpo = eCorpo
      .replace(/\bo usuário\s+acesso\b/i, 'o usuário acessa')
      .replace(/\bo usuário\s+clico\b/i, 'o usuário clica')
      .replace(/\bo usuário\s+confirmo\b/i, 'o usuário confirma')
      .replace(/^o usuário\s+(existem|existe)\s/i, '$1 ')
      .replace(/\bo usuário\s+o\s+/gi, 'o ')
      .replace(/\bo usuário\s+a\s+aplica[cç][ãa]o\b/i, 'a aplicação')
      .replace(/\bo usuário\s+(o\s+)?servi[cç]o\b/i, 'o serviço')
      .replace(/\bo usuário\s+(o\s+)?cadastro\b/i, 'o cadastro')
      .replace(/\bo usuário\s+(o\s+)?estudo\b/i, 'o estudo')
      .replace(/,\s*depois(?:,\s*depois)+\s*/gi, ', ');
    return `    E ${eCorpo}`;
  }
  if (prefix === 'Dado que') return `  Dado que ${corpo}`;
  if (prefix === 'Quando') {
    if (/^(a|o|os|as)\s+/i.test(corpo) && !/^o\s+usu[aá]rio\s+/i.test(corpo)) {
      return `  Quando ${corpo}`;
    }
    let q = corpo;
    if (/^usu[aá]rio\b/i.test(corpo)) {
      q = corpo.charAt(0).toLowerCase() + corpo.slice(1);
    } else if (!/^o\s+usu[aá]rio\s+/i.test(corpo) && !/^usu[aá]rios?\b/i.test(corpo)) {
      q = `o usuário ${corpo}`;
    }
    q = q
      .replace(/\bo usuário\s+envio\b/i, 'o usuário envia')
      .replace(/\bo usuário\s+gravo\b/i, 'o usuário grava')
      .replace(/\bo usuário\s+abro\b/i, 'o usuário abre')
      .replace(/\bo usuário\s+comparo\b/i, 'o usuário compara')
      .replace(/\bo usuário\s+aguardo\b/i, 'o usuário aguarda')
      .replace(/\bo usuário\s+adicionar\b/i, 'o usuário adiciona')
      .replace(/\bo usuário\s+carrego\b/i, 'o usuário carrega')
      .replace(/\bo usuário\s+seleciono\b/i, 'o usuário seleciona')
      .replace(/\bo usuário\s+visualizo\b/i, 'o usuário visualiza')
      .replace(/\bo usuário\s+clico\b/i, 'o usuário clica')
      .replace(/\bo usuário\s+confirmo\b/i, 'o usuário confirma')
      .replace(/\bo usuário\s+(a|o|os|as)\s+/i, '$1 ');
    return `  Quando ${q}`;
  }
  return `  Então ${corpo}`;
}

/**
 * Extrai itens de listas numeradas ou por linha (1 -, 2), bullets).
 * @param {string} texto
 * @returns {string[]}
 */
const VERBOS_PASSO_COLADOS =
  'Acessar|Abrir|Configurar|Inserir|Salvar|Verificar|Validar|Confirmar|Comparar|Registrar|Aplicar|Selecionar|Informar|Clicar|Preencher|Exportar|Imprimir|Localizar|Navegar|Aguardar|Realizar|Executar|Visualizar|Editar|Remover|Excluir|Filtrar|Pesquisar|Enviar|Receber|Autenticar|Login|Logout';

/**
 * Separa passos colados pelo Bitrix (ex.: "portal VetConfigurar/inserir...Salvar...").
 * @param {string} texto
 */
function desconcatenarPassosColados(texto) {
  let t = String(texto || '').trim();
  if (!t) return t;
  t = t.replace(/\//g, ' e ');
  const re = new RegExp(
    `([a-záéíóúãõ0-9])((?:${VERBOS_PASSO_COLADOS}))(?=[\\s/]|$|[A-ZÁÉÍÓÚ])`,
    'g'
  );
  t = t.replace(re, '$1\n$2');
  return t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function preservarQuebrasDeLinha(texto) {
  let t = String(texto || '')
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(
      /^(descrição|contexto|passo|resultado|observação)\s*(do\s+ocorrido)?\s*:\s*/gim,
      ''
    );
  if (t && !/\n/.test(t) && (passoEhColagemGherkin(t) || new RegExp(VERBOS_PASSO_COLADOS, 'i').test(t))) {
    t = desconcatenarPassosColados(t);
  }
  return t;
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
  const maxE = opts.maxE ?? maxEPorCenario();
  const maxSlots = 1 + maxE;

  const partes = extrairPassosDoTexto(passos);
  if (partes.length >= 2) {
    const brutas = [];
    for (const p of partes) {
      if (linhaEhRotuloChamado(p) || passoEhPlaceholder(p)) continue;
      const corpo = objetivarFrase(p);
      if (!corpo || passoEhColagemGherkin(corpo)) continue;
      brutas.push(corpo);
    }
    if (brutas.length >= 2 && brutas.length <= maxSlots + 1) {
      return acoesParaLinhasGherkin(brutas.slice(0, maxSlots));
    }
  }

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
  /** @type {string[]} */
  const entoes = [];
  /** @type {string[]} */
  const ePosEntao = [];
  let mas = null;
  let viuQuando = false;
  let viuEntao = false;

  for (const ln of linhas || []) {
    const t = String(ln || '').trimEnd();
    if (!t) continue;
    if (/^\s*Dado/i.test(t)) {
      dado.push(t.replace(/^\s*/, (m) => (m.length >= 2 ? '  ' : '  ')));
      continue;
    }
    if (/^\s*Então/i.test(t)) {
      viuEntao = true;
      entoes.push(t.startsWith('  ') ? t : `  ${t.trim()}`);
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
      if (viuEntao) {
        ePosEntao.push(norm);
        continue;
      }
      if (!viuQuando && !acao.length) dado.push(norm);
      else acao.push(norm);
      continue;
    }
    if (!viuQuando && !acao.length) dado.push(t);
    else acao.push(t);
  }

  const entao = entoes[0] || null;
  return { dado, acao, entao, entoes, mas, ePosEntao };
}

function listaEntoesSeparados(separado) {
  if (separado.entoes?.length) return separado.entoes;
  return separado.entao ? [separado.entao] : [];
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
  const { bddInternalCommentsEnabled } = require('./bdd-crm-merge');
  if (!bddInternalCommentsEnabled() || process.env.BDD_COBERTURA_REF === '0') return [];
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
        titulo: normalizarTitulo(`${tituloBase}, ${faseLabel}`),
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
        textos.length > janela && parteFluxo > 1 ? ' (continuação)' : '';
      blocos.push({
        titulo: normalizarTitulo(`${tituloBase}, ${faseLabel}${suffixCont}`),
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
function dividirCenarioPorTotalPassos(tituloBase, dado, acao, entoes, mas, opts = {}) {
  const listaEntao = Array.isArray(entoes) ? entoes : entoes ? [entoes] : [];
  const maxE = maxEPorCenario();
  const maxSlots = 1 + maxE;
  const janela = maxAcoesBrutasPorCenario();
  const dadoAmb = primeiraLinhaDado(dado);
  const textos = extrairTextosPassosDeLinhas(acao);

  if (!textos.length) {
    const corpo = [
      ...(dadoAmb ? [dadoAmb] : dado),
      '  Quando o usuário executa o fluxo descrito no chamado',
    ];
    corpo.push(...listaEntao);
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
    const corpo = [...dado, ...partes[0]];
    corpo.push(...listaEntao);
    if (mas) corpo.push(mas);
    return [montarBlocoCenario(tituloBase, corpo, opts)];
  }

  return partes.map((acaoPart, idx) => {
    const suffix = sufixoContinuacaoCenario(idx);
    const prefixo =
      idx === 0
        ? dado.length
          ? dado
          : dadoAmb
            ? [dadoAmb]
            : []
        : [dadoContinuacaoFluxo()];
    const corpo = [...prefixo, ...acaoPart];
    const ultimo = idx === partes.length - 1;
    if (ultimo) corpo.push(...listaEntao);
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
/** Garante no máximo um Então verificável por cenário. */
function garantirUmEntaoPorCenario(linhasCorpo) {
  const sep = separarTiposLinhas(linhasCorpo);
  const entoes = fundirEntoesEmUm(listaEntoesSeparados(sep));
  const out = [...sep.dado, ...sep.acao];
  if (entoes.length) out.push(...entoes);
  if (sep.ePosEntao?.length) out.push(...sep.ePosEntao);
  if (sep.mas) out.push(sep.mas);
  return out;
}

function corpoJaFormatadoGherkin(linhasCorpo) {
  const linhas = (linhasCorpo || []).filter((l) => String(l || '').trim());
  if (linhas.length < 3) return false;
  const tem = (re) => linhas.some((l) => re.test(String(l)));
  return tem(/^\s*Dado/i) && tem(/^\s*Quando/i) && tem(/^\s*Ent[aã]o/i);
}

/** Compacta Dado/E/Quando/Então antes de dividir ou gravar. */
function compactarCorpoCenario(linhasCorpo) {
  if (corpoJaFormatadoGherkin(linhasCorpo)) {
    const sep = separarTiposLinhas(linhasCorpo);
    const dadoAmb = sep.dado.filter((l) => /^\s*Dado/i.test(l));
    const eDado = sep.dado.filter((l) => isLinhaE(l));
    const eDadoLimitado = limitarESteps(
      eDado.map((l) => l.replace(/^\s*E\s+/i, '').trim()),
      Math.min(3, maxEPorCenario())
    );
    const entoes = fundirEntoesEmUm(listaEntoesSeparados(sep));
    const out = dedupeLinhasE([
      ...dadoAmb.map(corrigirLinhaDadoAmbiente),
      ...eDadoLimitado,
      ...sep.acao,
      ...entoes,
      ...(sep.ePosEntao || []),
    ]);
    if (sep.mas) out.push(sep.mas);
    return out;
  }
  const sep = separarTiposLinhas(linhasCorpo);
  const dadoAmb = sep.dado.filter((l) => /^\s*Dado/i.test(l));
  const eDado = sep.dado.filter((l) => isLinhaE(l));
  const eDadoLimitado = limitarESteps(
    eDado.map((l) => l.replace(/^\s*E\s+/i, '')),
    Math.min(2, maxEPorCenario())
  );
  const entoes = fundirEntoesEmUm(listaEntoesSeparados(sep));
  const textos = extrairTextosPassosDeLinhas(sep.acao);
  const acaoLinhas = textos.length
    ? acoesParaLinhasGherkin(consolidarAcoesObjetivas(textos, maxEPorCenario()))
    : ['  Quando o usuário executa o fluxo descrito no cenário Dev'];
  const out = [...dadoAmb.map(corrigirLinhaDadoAmbiente), ...eDadoLimitado, ...acaoLinhas];
  if (entoes.length) out.push(...entoes);
  else if (sep.entao && !fraseEhIncompleta(sep.entao.replace(/^\s*ent[aã]o\s+/i, ''))) {
    out.push(sep.entao);
  }
  if (sep.ePosEntao?.length) out.push(...sep.ePosEntao);
  if (sep.mas) out.push(sep.mas);
  return out;
}

function dividirCenarioCompletoPorMaxE(tituloBase, linhasCorpo, opts = {}) {
  linhasCorpo = compactarCorpoCenario(linhasCorpo);
  const maxE = maxEPorCenario();
  const maxTotal = maxTotalEPorCenario();
  const separado = separarTiposLinhas(linhasCorpo);
  const { dado, acao, entao, mas } = separado;
  const listaEntao = fundirEntoesEmUm(listaEntoesSeparados(separado));

  const porFases = dividirCenarioPorFasesAmbiente(tituloBase, linhasCorpo, opts);
  if (porFases) return porFases;

  const totalE = contarLinhasE(dado) + contarLinhasE(acao);
  const textosAcao = extrairTextosPassosDeLinhas(acao);
  const janela = maxAcoesBrutasPorCenario();
  const acaoPreFormatada =
    acao.length > 0 &&
    acao.every((ln) => /^\s*(?:Quando|E)\s+/i.test(ln)) &&
    acao.some((ln) => /^\s*Quando/i.test(ln));

  if (acaoPreFormatada && listaEntao.length && textosAcao.length <= janela) {
    const corpo = [...dado, ...acao];
    corpo.push(...listaEntao);
    if (separado.ePosEntao?.length) corpo.push(...separado.ePosEntao);
    if (mas) corpo.push(mas);
    return [montarBlocoCenario(tituloBase, corpo, opts)];
  }

  if (!textosAcao.length && totalE <= maxTotal) {
    const corpo = [
      ...dado,
      '  Quando o usuário executa o fluxo descrito no chamado',
    ];
    corpo.push(...listaEntao);
    if (mas) corpo.push(mas);
    return [montarBlocoCenario(tituloBase, corpo, opts)];
  }

  if (totalE > maxTotal || textosAcao.length > janela) {
    if (textosAcao.length <= janela && acao.some((ln) => /^\s*Quando/i.test(ln))) {
      const corpo = [...dado, ...acao];
      corpo.push(...listaEntao);
      if (mas) corpo.push(mas);
      return [montarBlocoCenario(tituloBase, corpo, opts)];
    }
    return dividirCenarioPorTotalPassos(tituloBase, dado, acao, listaEntao, mas, opts);
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
    corpo.push(...listaEntao);
    if (mas) corpo.push(mas);
    return [montarBlocoCenario(tituloBase, corpo, opts)];
  }

  return partesAcao.map((acaoPart, idx) => {
    const suffix = sufixoContinuacaoCenario(idx);
    const dadoAmb = primeiraLinhaDado(dado);
    const prefixo = idx === 0 ? (dadoAmb ? [dadoAmb] : []) : [dadoContinuacaoFluxo()];
    const corpo = [...prefixo, ...acaoPart];
    const ultimo = idx === partesAcao.length - 1;
    if (ultimo) corpo.push(...listaEntao);
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

  // "Cenário 1) Descrição: … Resultado Esperado: …" (parêntese — comum no SPA Feature 1272)
  if (/(?:cenário|cenario)\s*\d+\s*\)/i.test(bruto)) {
    const porParen = bruto
      .split(/(?=(?:cenário|cenario)\s*\d+\s*\))/i)
      .map((c) => c.replace(/^\s*---+\s*/g, '').trim())
      .filter((c) => limparTexto(c));
    if (porParen.length >= 1) {
      return porParen.map((chunk) => parseDevChunkDescricaoResultado(chunk));
    }
  }

  // "Cenário 1: …" ou "**Cenário 1:** …" no mesmo parágrafo
  if (/(?:\*\*)?\s*(?:cenário|cenario)\s*\d+\s*:/i.test(bruto)) {
    const porNumInline = bruto
      .split(/(?=(?:\*\*)?\s*(?:cenário|cenario)\s*\d+\s*:)/i)
      .map((c) => c.replace(/^\s*---+\s*/g, '').trim())
      .filter((c) => limparTexto(c) && !/^\*+$/.test(c.replace(/\s/g, '')));
    if (porNumInline.length >= 1) {
      return porNumInline
        .map((chunk) => parseDevChunkMarkdownCenario(chunk))
        .filter((b) => b && limparTexto(b.body) && (b.title || b.body.length > 24));
    }
  }

  const porCenario = bruto
    .split(/(?=^\s*(?:cenário|cenario)\s*(?:\d+\s*)?:)/gim)
    .filter((c) => limparTexto(c));
  if (porCenario.length > 1) {
    return porCenario.map((chunk) => parseDevChunk(chunk));
  }

  // "Cenário 1 Ação: … Resultado - …" (com ou sem quebra de linha entre blocos)
  if (/(?:cenário|cenario)\s*\d+\s+a[cç][ãa]o\s*:/i.test(bruto)) {
    const porAcaoInline = bruto
      .split(/(?=(?:cenário|cenario)\s*\d+\s+a[cç][ãa]o\s*:)/i)
      .filter((c) => limparTexto(c));
    if (porAcaoInline.length >= 1) {
      return porAcaoInline.map((chunk) => parseDevChunkAcaoResultado(chunk));
    }
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

  // Lista inline: "1 - Passo A 2 - Passo B" (sem quebra de linha — comum em Features)
  if (/\d+\s*[-–—.)]+\s/.test(bruto) && !/(?:cenário|cenario)\s*\d/i.test(bruto)) {
    const porNumInline = bruto
      .split(/(?<!\d)(?<=\S)\s+(?=\d+\s*[-–—.)]+\s)/)
      .map((c) => c.trim())
      .filter((c) => limparTexto(c));
    if (porNumInline.length > 1) {
      return porNumInline.map((chunk, i) => parseDevChunk(chunk, `Passo ${i + 1}`));
    }
  }

  // Lista inline: "- Dado …, ao …, deverá … - Dado …" (comum em Features DICOM)
  if (/(?:^|\s)-\s*(?:Dado|Given)\b/i.test(bruto) || /^(?:Dado|Given)\b/i.test(bruto)) {
    const porDado = bruto
      .split(/\s+-\s+(?=(?:Dado|Given)\b)/i)
      .map((c) => c.replace(/^\s*-\s*/, '').trim())
      .filter((c) => limparTexto(c));
    if (porDado.length >= 1) {
      const blocos = porDado
        .map((chunk) => {
          const cond = parseDevChunkDadoCondicional(chunk);
          if (cond) return cond;
          const dr = parseDevChunkDescricaoResultado(chunk);
          if (dr && limparTexto(dr.body)) return dr;
          return parseDevChunk(chunk, null);
        })
        .filter((b) => b && limparTexto(b.body));
      if (blocos.length >= 1) return blocos;
    }
  }

  const condUnico = parseDevChunkDadoCondicional(bruto);
  if (condUnico) return [condUnico];

  const mParenFluxos = bruto.match(/\(([^)]+)\)/);
  if (mParenFluxos && mParenFluxos[1].includes('|')) {
    const prefix = bruto.slice(0, mParenFluxos.index);
    const suffix = bruto.slice((mParenFluxos.index || 0) + mParenFluxos[0].length);
    const fluxos = mParenFluxos[1]
      .split(/\|/)
      .map((f) => f.trim())
      .filter((f) => f.length > 8);
    if (fluxos.length > 1) {
      return fluxos.map((fluxo) =>
        parseDevChunk(`${prefix}${fluxo}${suffix}`, fluxo.slice(0, 96))
      );
    }
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
          ? normalizarTitulo(`${tituloBase}, ${sufixo}`)
          : normalizarTitulo(tituloBase);
        const qLine = String(quando || '').replace(/^\s+/, '').trim();
        const eLine = String(entao || '').replace(/^\s+/, '').trim();
        const corpo = `${qLine}\n${eLine}`;
        blocos.push(
          parseDevChunk(
            `Cenário: ${sectionTitle}, ${tituloCurto}\n${corpo}`,
            `${sectionTitle}, ${tituloCurto}`
          )
        );
      }
    }
  }

  return blocos.length ? blocos : null;
}

/** Converte **Given:** / **When:** / **Then:** inline em linhas separadas. */
function normalizarGwtInline(body) {
  return String(body || '')
    .replace(/\*{0,2}\s*given\s*:\*{0,2}/gi, '\nGiven: ')
    .replace(/\*{0,2}\s*when\s*:\*{0,2}/gi, '\nWhen: ')
    .replace(/\*{0,2}\s*then\s*:\*{0,2}/gi, '\nThen: ');
}

function corpoTemFormatoGwtDev(body) {
  return /(?:\*\*)?\s*(?:given|when|then)\s*:/i.test(String(body || ''));
}

/** Remove marcador de lista em linhas Given/When/Then Dev. */
function limparBulletGwtDev(texto) {
  return limparMarkdownCru(String(texto || ''))
    .replace(/^[-–—•*]\s+/, '')
    .trim();
}

/** Pré-condição Given → passo E (sem prefixar "o usuário" em "Existe…"). */
function preparacaoGivenParaE(texto) {
  const prep = objetivarFraseDev(texto) || limparTexto(texto);
  if (!prep) return null;
  if (/^o\s+usu[aá]rio\b/i.test(prep) || /^usu[aá]rio\b/i.test(prep)) {
    return prep.replace(/^usu[aá]rio\b/i, 'o usuário').replace(/^o\s+usu[aá]rio\s+/i, 'o usuário ');
  }
  if (
    /^(a|o)\s+aplica[cç][ãa]o\b/i.test(prep) ||
    /^(existem|existe|há|o\s+storage|a\s+listagem|um\s+ou\s+mais)\b/i.test(prep)
  ) {
    return prep.charAt(0).toLowerCase() + prep.slice(1);
  }
  if (/^(os|as|um|uma)\b/i.test(prep)) {
    return prep.charAt(0).toLowerCase() + prep.slice(1);
  }
  return `o usuário ${prep.charAt(0).toLowerCase() + prep.slice(1)}`;
}

/**
 * Blocos multilinha **Given:** / **When:** / **Then:** (comum em cards DICOM).
 * @returns {{ given: string[], when: string[], then: string[] }}
 */
function parseSecoesGwtDev(body) {
  const lines = normalizarGwtInline(body)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^---+$/.test(l));

  /** @type {{ given: string[], when: string[], then: string[] }} */
  const sections = { given: [], when: [], then: [] };
  /** @type {'given'|'when'|'then'|null} */
  let phase = null;

  for (const l of lines) {
    const mg = l.match(/^given\s*:\s*(.*)$/i);
    if (mg) {
      phase = 'given';
      const rest = limparMarkdownCru(mg[1]).trim();
      if (rest) sections.given.push(rest);
      continue;
    }
    const mw = l.match(/^when\s*:\s*(.*)$/i);
    if (mw) {
      phase = 'when';
      const rest = limparMarkdownCru(mw[1]).trim();
      if (rest) sections.when.push(rest);
      continue;
    }
    const mt = l.match(/^then\s*:\s*(.*)$/i);
    if (mt) {
      phase = 'then';
      const rest = limparMarkdownCru(mt[1]).trim();
      if (rest) sections.then.push(rest);
      continue;
    }
    if (!phase) continue;
    const clean = limparBulletGwtDev(l);
    if (clean) sections[phase].push(clean);
  }

  return sections;
}

function maxEntaoPorCenarioDev() {
  const n = Number.parseInt(process.env.BDD_MAX_ENTAO_DEV || '1', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 3) : 1;
}

/** Funde vários Então em um único critério verificável por cenário. */
function fundirEntoesEmUm(entaoList) {
  const { formatarEntaoDevResultado, splitResultadoDevEmAssercoes } = require('./bdd-validacoes');
  const partes = [];
  for (const ln of entaoList || []) {
    const corpo = String(ln)
      .replace(/^\s*ent[aã]o\s+/i, '')
      .replace(/\s*---+\s*$/g, '')
      .replace(/…+$/g, '')
      .trim();
    if (!corpo || textoEhLixoEvidenciaOuTimeline(corpo)) continue;
    const assercoes =
      corpo.length > 100 ? splitResultadoDevEmAssercoes(corpo) : [corpo];
    for (const ass of assercoes) {
      if (!ass || fraseEhIncompleta(ass)) continue;
      const ev =
        formatarEntaoDevResultado(ass) ||
        entaoVerificavelDev(ass) ||
        entaoVerificavel(ass);
      if (ev && !fraseEhIncompleta(ev) && !/…/.test(ev)) partes.push(ev);
    }
  }
  if (!partes.length) return [];
  const principal =
    partes.find((p) => /\bdeve\b/i.test(p) && p.length <= MAX_ENTAO_DEV_CHARS) ||
    partes.find((p) => !fraseEhIncompleta(p)) ||
    partes[0];
  if (!principal || fraseEhIncompleta(principal)) return [];
  return [`  Então ${principal}`];
}

function dedupeLinhasE(linhas) {
  const out = [];
  const vistos = [];
  for (const ln of linhas || []) {
    if (!isLinhaE(ln)) {
      out.push(ln);
      continue;
    }
    const t = String(ln)
      .replace(/^\s*E\s+/i, '')
      .trim()
      .toLowerCase();
    if (!t) continue;
    const dup = vistos.some((v) => v.includes(t) || t.includes(v));
    if (dup) continue;
    vistos.push(t);
    out.push(ln);
  }
  return out;
}

function limitarESteps(eSteps, maxE) {
  const textos = (eSteps || [])
    .map((s) => String(s).replace(/^\s*E\s+/i, '').trim())
    .filter((t) => t && !textoEhLixoEvidenciaOuTimeline(t));
  if (!textos.length) return [];
  if (textos.length <= maxE) {
    return textos.map((t) => `    E ${t}`);
  }
  const resumidas = consolidarAcoesObjetivas(textos, maxE);
  return resumidas.map((t) => `    E ${t}`);
}

function corrigirLinhaDadoAmbiente(linha) {
  return String(linha || '').replace(
    /(acessa\s+o\s+ambiente\s+)\[([A-Za-z][A-Za-z0-9]*)\b/gi,
    '$1$2'
  );
}

function maxGivenPorCenarioDev() {
  const n = Number.parseInt(process.env.BDD_MAX_GIVEN_DEV || '3', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 4) : 3;
}

/** Monta Quando/E/Então a partir de seções Given/When/Then Dev. */
function montarPassosDeSecoesGwt(gwt) {
  const {
    splitAssercoesEspacoDuplo,
    splitAssercoesColadas,
    splitResultadoDevEmAssercoes,
    formatarEntaoDevResultado,
  } = require('./bdd-validacoes');

  const eSteps = [];
  const maxGiven = maxGivenPorCenarioDev();
  for (const g of gwt.given) {
    const frases = splitAssercoesColadas(g).flatMap((fr) => {
      const sub = fr
        .split(
          /\s+(?=(?:O usuário|A aplicação|A unidade|A API|O sistema|O storage|O serviço|Os serviços|Um ou mais|Um storage|Existe um|Existem|Existe|Cada nó)\b)/i
        )
        .map((s) => s.trim())
        .filter((s) => s.length >= 10);
      return sub.length > 1 ? sub : splitAssercoesEspacoDuplo(fr);
    });
    for (const fr of frases.slice(0, maxGiven)) {
      if (textoEhLixoEvidenciaOuTimeline(fr)) continue;
      const eText = preparacaoGivenParaE(fr);
      if (eText && eText.length >= 10 && !textoEhLixoEvidenciaOuTimeline(eText)) {
        eSteps.push(`    E ${eText}`);
      }
    }
  }

  let quando = null;
  /** @type {string[]} */
  const ePosQuando = [];
  const whenParts = [];
  for (const w of gwt.when) {
    const colados = splitPassosColados(w);
    whenParts.push(...(colados.length > 1 ? colados : splitAssercoesEspacoDuplo(w)));
  }
  const whenUnicos = [...new Set(whenParts.map((p) => p.trim()).filter((p) => p.length >= 8))];
  const whenNorm = whenUnicos
    .map((w) => objetivarFraseDev(w) || limparTexto(w))
    .filter((w) => w && !textoEhLixoEvidenciaOuTimeline(w));
  if (whenNorm.length) {
    quando = quandoAPartirDeDescricaoDev(whenNorm[0]);
    for (let i = 1; i < Math.min(whenNorm.length, maxEPorCenario()); i++) {
      const prep = whenNorm[i];
      let e = null;
      if (/^a tarefa\b/i.test(prep)) {
        e = `    E ${prep.charAt(0).toLowerCase() + prep.slice(1)}`;
      } else {
        e = passoGherkin('E', prep);
      }
      if (e) ePosQuando.push(e);
    }
  }

  /** @type {string[]} */
  const entaoList = [];
  /** @type {string[]} */
  const ePosEntao = [];
  for (const t of gwt.then) {
    const limpo = limparBulletGwtDev(t);
    if (!limpo) continue;
    const partes =
      limpo.length > 140 ? splitResultadoDevEmAssercoes(limpo) : [limpo];
    for (const parte of partes) {
      const ev = formatarEntaoDevResultado(parte);
      if (ev && !fraseEhIncompleta(ev)) {
        entaoList.push(`  Então ${ev}`);
      }
    }
  }
  const entaoFundido = fundirEntoesEmUm(entaoList);
  for (let i = 1; i < entaoList.length; i++) {
    const corpo = entaoList[i].replace(/^\s*ent[aã]o\s+/i, '').trim();
    if (corpo && !fraseEhIncompleta(corpo)) {
      ePosEntao.push(`    E ${corpo.charAt(0).toLowerCase() + corpo.slice(1)}`);
    }
  }

  return {
    quando,
    entao: entaoFundido[0] || null,
    entaoList: entaoFundido,
    eSteps: limitarESteps(eSteps, Math.min(2, maxEPorCenario())),
    ePosQuando,
    ePosEntao,
  };
}

/** Quando/Então já escritos no corpo do bloco Dev (Gherkin ou Given/When/Then). */
function extrairQuandoEntaoDoCorpo(body) {
  if (corpoTemFormatoGwtDev(body)) {
    const gwt = parseSecoesGwtDev(body);
    if (gwt.when.length || gwt.then.length) {
      const montado = montarPassosDeSecoesGwt(gwt);
      if (montado.entaoList?.length || montado.entao) {
        if (!montado.entaoList?.length && montado.entao) {
          montado.entaoList = [montado.entao];
        }
        return montado;
      }
    }
  }

  const lines = normalizarGwtInline(body)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let quando = null;
  let entao = null;
  /** @type {string[]} */
  let entaoList = [];
  const eSteps = [];

  for (const l of lines) {
    const mq = l.match(/^quando\s+(.+)$/i);
    if (mq) {
      const norm = normalizarLinhaGherkin(`Quando ${mq[1]}`);
      quando = norm || passoGherkin('Quando', mq[1]);
      continue;
    }
    const me = l.match(/^ent[aã]o\s+(.+)$/i);
    if (me) {
      const norm = normalizarLinhaGherkin(`Então ${me[1]}`);
      const line =
        norm ||
        (entaoVerificavel(me[1]) ? `  Então ${entaoVerificavel(me[1])}` : null);
      if (line) {
        entao = line;
        entaoList.push(line);
      }
      continue;
    }

    const mg = l.match(/^\*{0,2}\s*given\s*:\*{0,2}\s*(.+)$/i);
    if (mg) {
      const givenBlob = limparMarkdownCru(mg[1]).trim();
      const { splitAssercoesColadas } = require('./bdd-validacoes');
      const frases = splitAssercoesColadas(givenBlob)
        .map((f) => objetivarFrase(f, 100))
        .filter(Boolean);
      for (const prep of frases.length ? frases : [objetivarFrase(givenBlob, 100)].filter(Boolean)) {
        const eText =
          /^(o|a|os|as|um|uma|sou|estou|existem|gerencio|há)\s/i.test(prep) || /^o\s+usu[aá]rio\s+/i.test(prep)
            ? prep
            : `o usuário ${prep}`;
        eSteps.push(`    E ${eText}`);
      }
      continue;
    }
    const mw = l.match(/^\*{0,2}\s*when\s*:\*{0,2}\s*(.+)$/i);
    if (mw) {
      const prep = objetivarFrase(limparMarkdownCru(mw[1]), 100);
      if (prep) {
        quando = passoGherkin('Quando', prep) || `  Quando o usuário ${prep}`;
      }
      continue;
    }
    const mt = l.match(/^\*{0,2}\s*then\s*:\*{0,2}\s*(.+)$/i);
    if (mt) {
      const thenBlob = limparMarkdownCru(mt[1]).trim();
      const { splitAssercoesColadas } = require('./bdd-validacoes');
      const frasesThen = splitAssercoesColadas(thenBlob)
        .map((f) => entaoVerificavel(f))
        .filter(Boolean);
      const ev = frasesThen[0] || entaoVerificavel(thenBlob);
      if (ev) entao = `  Então ${ev}`;
      if (frasesThen.length > 1) {
        entaoList = frasesThen.map((f) => `  Então ${f}`);
      }
    }
  }

  if (!quando || !entao) {
    const blob = lines.join(' ');
    const mAr = blob.match(
      /a[cç][ãa]o\s*:\s*(.+?)\s+resultado\s*[-–—:]\s*(.+)$/i
    );
    if (mAr) {
      const acao = limparMarkdownCru(mAr[1]).trim();
      const res = limparMarkdownCru(mAr[2]).trim();
      const prep = objetivarFrase(acao, 100) || acao;
      if (!quando && prep) {
        quando = passoGherkin('Quando', prep) || `  Quando o usuário ${prep}`;
      }
      if (!entao && res) {
        const ev = entaoVerificavel(res);
        if (ev) entao = `  Então ${ev}`;
      }
    }
  }

  if (!quando || !entao) {
    const blob = normalizarGwtInline(body).replace(/\r?\n/g, ' ').trim();
    const mDr = blob.match(
      /descri[cç][ãa]o\s*:\s*(.+?)\s+resultado\s+esperado\s*:\s*(.+)$/is
    );
    if (mDr) {
      const descricao = limparMarkdownCru(mDr[1]).trim();
      const resultado = limparMarkdownCru(mDr[2]).trim();
      if (!quando && descricao) {
        quando = quandoAPartirDeDescricaoDev(descricao);
      }
      if (!entao && resultado) {
        const { splitResultadoDevEmAssercoes, formatarEntaoDevResultado } = require('./bdd-validacoes');
        const frasesThen = splitResultadoDevEmAssercoes(resultado)
          .map((f) => formatarEntaoDevResultado(f))
          .filter(Boolean);
        if (frasesThen.length) {
          entao = `  Então ${frasesThen[0]}`;
          if (frasesThen.length > 1) {
            entaoList = frasesThen.map((f) => `  Então ${f}`);
          }
        }
      }
    }
  }

  if (!entao) {
    const blobSolo = normalizarGwtInline(body).replace(/\r?\n/g, ' ').trim();
    const mSolo = blobSolo.match(/^resultado\s+esperado\s*:\s*(.+)$/is);
    if (mSolo) {
      const { splitResultadoDevEmAssercoes, formatarEntaoDevResultado } = require('./bdd-validacoes');
      const frasesThen = splitResultadoDevEmAssercoes(mSolo[1])
        .map((f) => formatarEntaoDevResultado(f))
        .filter(Boolean);
      if (frasesThen.length) {
        entao = `  Então ${frasesThen[0]}`;
        if (frasesThen.length > 1) {
          entaoList = frasesThen.map((f) => `  Então ${f}`);
        }
      }
    }
  }

  if (!entaoList.length && entao) entaoList = [entao];
  return { quando, entao, entaoList, eSteps, ePosQuando: [] };
}

/**
 * Formato Dev: "Cenário 1) Descrição: … Resultado Esperado: …"
 * @param {string} chunk
 */
function parseDevChunkDescricaoResultado(chunk) {
  let bruto = String(chunk || '').trim();
  const mHeader = bruto.match(/^(?:cenário|cenario)\s*(\d+)\s*\)\s*/i);
  const num = mHeader ? mHeader[1] : null;
  if (mHeader) bruto = bruto.slice(mHeader[0].length).trim();

  const blob = bruto.replace(/\r?\n/g, ' ').trim();
  const mInline = blob.match(
    /descri[cç][ãa]o\s*:\s*(.+?)\s+resultado\s+esperado\s*:\s*(.+)$/is
  );
  if (mInline) {
    const descricao = limparMarkdownCru(mInline[1]).trim();
    const resultado = limparMarkdownCru(mInline[2]).trim();
    const title =
      tituloCenarioCurto(descricao, 88) || (num ? `Cenário ${num}` : 'Cenário Dev');
    const body = `Descrição: ${descricao}\nResultado Esperado: ${resultado}`;
    return { title, body, lines: body.split(/\r?\n/) };
  }

  let descricao = '';
  let resultado = '';
  for (const line of bruto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const md = line.match(/^descri[cç][ãa]o\s*:\s*(.*)$/i);
    if (md) {
      descricao = limparMarkdownCru(md[1]).trim();
      continue;
    }
    const mr = line.match(/^resultado\s+esperado\s*:\s*(.*)$/i);
    if (mr) {
      resultado = limparMarkdownCru(mr[1]).trim();
      continue;
    }
    if (resultado) resultado = `${resultado} ${line}`;
    else if (descricao) descricao = `${descricao} ${line}`;
  }

  if (descricao || resultado) {
    const title =
      tituloCenarioCurto(descricao, 88) || (num ? `Cenário ${num}` : 'Cenário Dev');
    const body = [
      descricao ? `Descrição: ${descricao}` : '',
      resultado ? `Resultado Esperado: ${resultado}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return { title, body, lines: body.split(/\r?\n/) };
  }

  const corpoAssertivo = limparMarkdownCru(bruto).trim();
  if (corpoAssertivo.length >= 10) {
    const title = tituloCenarioCurto(corpoAssertivo, 88) || (num ? `Cenário ${num}` : 'Cenário Dev');
    const body = `Resultado Esperado: ${corpoAssertivo}`;
    return { title, body, lines: [body] };
  }

  return parseDevChunk(chunk, num ? `Cenário ${num}` : null);
}

/** Frase Dev completa (sem corte agressivo de 120 chars). */
function objetivarFraseDev(frase) {
  let f = removerRuidoColagem(removerRotulos(limparMarkdownCru(frase)));
  if (!f) return '';
  f = f.replace(/\s+/g, ' ').trim();
  const limite = MAX_QUANDO_DEV_CHARS * 1.35;
  if (f.length > limite) {
    f = truncarSemCortar(f, limite, 48);
  }
  return f;
}

/** Então fiel ao Resultado Esperado Dev (limite maior, sem pegar só a 1ª frase). */
function entaoVerificavelDev(texto) {
  let t = limparMarkdownCru(stripTextoAdministrativo(String(texto || '')));
  t = t
    .replace(/^resultado\s+esperado\s*:\s*/i, '')
    .replace(/^(?:dado|given)\s+.+?,\s*ao\s+.+?,\s*dever[aá]\s+/is, '')
    .replace(/^(?:dado|given)\s+.+?,\s*dever[aá]\s+/is, '')
    .trim();
  if (!t) return '';
  t = t
    .replace(/^dever[aá]\s+/i, '')
    .replace(/^deve\s+/i, '')
    .replace(/^o\s+sistema\s+deve\s+/i, '')
    .trim();
  if (t.length > MAX_ENTAO_DEV_CHARS) {
    const { splitResultadoDevEmAssercoes } = require('./bdd-validacoes');
    for (const parte of splitResultadoDevEmAssercoes(t)) {
      let curta = limparMarkdownCru(stripTextoAdministrativo(parte))
        .replace(/^deve\s+/i, '')
        .replace(/^a aplicação\s+deve\s+/i, 'a aplicação deve ')
        .trim();
      if (curta.length <= MAX_ENTAO_DEV_CHARS && !fraseEhIncompleta(curta)) {
        return curta;
      }
    }
    const pf = primeiraFrase(t);
    if (pf && pf.length <= MAX_ENTAO_DEV_CHARS && !fraseEhIncompleta(pf)) {
      return pf.replace(/^deve\s+/i, '').trim();
    }
    t = truncarSemCortar(t, MAX_ENTAO_DEV_CHARS, 40);
  }
  if (fraseEhIncompleta(t) && /\bdeve\b/i.test(String(texto || ''))) {
    const bruto = limparMarkdownCru(stripTextoAdministrativo(String(texto || '')))
      .replace(/^resultado\s+esperado\s*:\s*/i, '')
      .trim();
    if (bruto && bruto.length > t.length && !fraseEhIncompleta(bruto)) {
      return bruto.length > MAX_ENTAO_DEV_CHARS
        ? truncarSemCortar(bruto, MAX_ENTAO_DEV_CHARS, 40)
        : bruto;
    }
  }
  const hadDeve = /\bdeve(?:r[aá])?\b/i.test(String(texto || ''));
  if (t && hadDeve && !/\bdeve(?:r[aá])?\b/i.test(t)) {
    t = /^ser\s+/i.test(t) ? `deve ${t}` : `deve ${t}`;
  }
  return t;
}

/** Cenários Dev só com regra assertiva (sem Descrição/ação explícita). */
function quandoAPartirDeAssertivoDev(bloco) {
  const texto = limparTexto(
    `${bloco?.title || ''} ${String(bloco?.body || '').replace(/^resultado\s+esperado\s*:\s*/i, '')}`
  );
  const t = texto.toLowerCase();
  if (/empresa original.*n[aã]o deve|n[aã]o deve.*empresa original/.test(t)) {
    return '  Quando o usuário da empresa que recebeu o exame executa processos sobre o exame compartilhado';
  }
  if (/n[aã]o pode visualizar|n[aã]o faz parte/.test(t)) {
    return '  Quando o usuário tenta acessar exames de empresas às quais não pertence';
  }
  if (/mesmas permiss[oõ]es|de cada perfil/.test(t)) {
    return '  Quando o usuário de cada perfil da empresa receptora acessa o exame compartilhado';
  }
  if (
    /^(o|a|os|as)\s+usu[aá]rios?\b/i.test(texto) ||
    /^a empresa\b/i.test(texto) ||
    /\bdeve\b|\bn[aã]o deve\b|\bn[aã]o pode\b/i.test(texto)
  ) {
    const regra = objetivarFraseDev(
      bloco?.title || texto.replace(/^resultado\s+esperado\s*:\s*/i, '')
    );
    if (regra && regra.length >= 12) {
      return '  Quando o usuário executa ações no Portal para validar a regra de negócio do cenário';
    }
  }
  return null;
}

/** Evita "Quando o usuário usuário …" quando a frase já começa com Usuário. */
function quandoAPartirDeDescricaoDev(descricao) {
  const partes = splitPassosColados(descricao);
  const principal = partes[0] || descricao;
  const prep = objetivarFraseDev(principal) || limparTexto(principal);
  if (!prep) return null;
  if (/^a requisi[cç][ãa]o\b/i.test(prep)) {
    return `  Quando ${prep.charAt(0).toLowerCase() + prep.slice(1)}`;
  }
  if (/^usu[aá]rio\b/i.test(prep)) {
    const frase = prep.charAt(0).toLowerCase() + prep.slice(1);
    return `  Quando ${frase}`;
  }
  if (/^o\s+usu[aá]rio\s+/i.test(prep)) {
    return `  Quando ${prep.charAt(0).toLowerCase() + prep.slice(1)}`;
  }
  return `  Quando o usuário ${prep.charAt(0).toLowerCase() + prep.slice(1)}`;
}

/** Formato Dev: "Cenário 1 Ação: … Resultado - …" (uma linha ou bloco). */
/**
 * "Dado X, ao Y, deverá Z" ou "Dado X, deverá Z" (lista Dev sem numeração).
 * @param {string} chunk
 */
function parseDevChunkDadoCondicional(chunk) {
  let t = limparMarkdownCru(String(chunk || ''))
    .replace(/^[-–—•*]\s*/, '')
    .trim();
  if (!t) return null;

  const mCond = t.match(
    /^(?:dado|given)\s+(.+?),\s*ao\s+(.+?),\s*dever[aá]\s+(.+)$/is
  );
  if (mCond) {
    const precond = mCond[1].trim();
    const acao = mCond[2].trim();
    const resultado = mCond[3].trim().replace(/[.…]+$/g, '').trim();
    const title =
      tituloCenarioCurto(acao, 88) || tituloCenarioCurto(resultado, 88) || 'Cenário Dev';
    const body = [
      `Given: ${precond}`,
      `Descrição: ${acao}`,
      `Resultado Esperado: ${resultado}`,
    ].join('\n');
    return { title, body, lines: body.split(/\r?\n/) };
  }

  const mSimples = t.match(/^(?:dado|given)\s+(.+?),\s*dever[aá]\s+(.+)$/is);
  if (mSimples) {
    const precond = mSimples[1].trim();
    const resultado = mSimples[2].trim().replace(/[.…]+$/g, '').trim();
    const title = tituloCenarioCurto(resultado, 88) || 'Cenário Dev';
    const body = [
      `Given: ${precond}`,
      `Resultado Esperado: ${resultado}`,
    ].join('\n');
    return { title, body, lines: body.split(/\r?\n/) };
  }

  return null;
}

function parseDevChunkAcaoResultado(chunk) {
  const bruto = String(chunk || '').replace(/\s+/g, ' ').trim();
  const m = bruto.match(
    /^(?:cenário|cenario)\s*(\d+)\s+a[cç][ãa]o\s*:\s*(.+?)\s+resultado\s*[-–—:]\s*(.+)$/i
  );
  if (!m) return parseDevChunk(chunk);

  const acao = limparMarkdownCru(m[2]).trim();
  const resultado = limparMarkdownCru(m[3]).trim();
  const title = acao.slice(0, 120) || `Cenário ${m[1]}`;
  const body = [`Ação: ${acao}`, `Resultado: ${resultado}`].join('\n');
  return {
    title,
    body,
    lines: [body],
  };
}

/** Chunk iniciado com "**Cenário N:** Título" + corpo GWT. */
function parseDevChunkMarkdownCenario(chunk) {
  let bruto = String(chunk || '').trim();
  const mHead = bruto.match(
    /^(?:\*\*)?\s*(?:cenário|cenario)\s*(\d+)\s*:\s*\*{0,2}\s*(.+?)(?=\s*\*{0,2}\s*(?:given|when|then)\s*:|$)/is
  );
  if (mHead) {
    const title = limparMarkdownCru(mHead[2]).replace(/\*+$/g, '').trim();
    const idx = bruto.toLowerCase().search(/\*{0,2}\s*(?:given|when|then)\s*:/i);
    const body = idx >= 0 ? bruto.slice(idx).trim() : '';
    if (body) {
      return { title: title || `Cenário ${mHead[1]}`, body, lines: body.split(/\r?\n/) };
    }
  }
  return parseDevChunk(chunk, null);
}

function textoEhLixoEvidenciaOuTimeline(texto) {
  const t = String(texto || '').trim();
  return (
    /^--\s/.test(t) ||
    /\[\/?b\]|\[url\]|bbcode|anexos\]/i.test(t) ||
    /arrastar e soltar|navegar para 'dashboard'|clica no botão reenviar|reenviar estudo/i.test(t) ||
    /aguarda o processamento e a exibição do estudo/i.test(t)
  );
}

function parseDevChunk(chunk, tituloFallback = null) {
  const lines = chunk.split(/\r?\n/).map((l) => l.trimEnd());
  const first = (lines.find((l) => l.trim()) || '').trim();
  let title = tituloFallback;

  const mCen = first.match(/^(?:cenário|cenario)\s*(?:\d+\s*)?:\s*(.+)$/i);
  if (mCen) {
    let rest = mCen[1].trim().replace(/\s*---+\s*$/g, '');
    const corteCorpo = rest.search(
      /\*{0,2}\s*(?:given|when|then|a[cç][ãa]o|resultado)\s*:/i
    );
    if (corteCorpo > 8) {
      title = rest.slice(0, corteCorpo).trim();
      const corpoInline = rest.slice(corteCorpo).trim();
      lines.shift();
      if (corpoInline) lines.unshift(corpoInline);
    } else {
      title = rest;
      lines.shift();
    }
  } else {
    const mMarc = first.match(/\[\s*cenário[^\]]*\]\s*:?\s*(.*)$/i);
    if (mMarc) {
      title = (mMarc[1] || first).trim() || tituloFallback;
    } else {
      const mNum = first.match(/^\d+\s*[-–—.)]+\s*(.+)$/);
      if (mNum) {
        title = mNum[1].trim();
        lines.shift();
      }
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

function textoBlocoDev(bloco) {
  const parts = [];
  if (bloco?.body && limparTexto(bloco.body)) parts.push(limparTexto(bloco.body));
  if (bloco?.title && limparTexto(bloco.title)) parts.push(limparTexto(bloco.title));
  return parts.join('\n');
}

/** Imperativo no título Dev: "Realizar …", "Tentar …", "Validar …". */
function quandoAPartirDeTituloDev(titulo) {
  const t = normalizarTitulo(String(titulo || ''));
  const m = t.match(
    /^(realizar|tentar|selecionar|validar|acessar|abrir|enviar|registrar|visualizar|clicar|aplicar|informar|configurar|alterar)\s+(.+)$/i
  );
  if (!m) return null;
  const verbo = m[1].toLowerCase();
  const resto = m[2].trim();
  return passoGherkin('Quando', `o usuário ${verbo} ${resto}`);
}

/** Lista numerada Dev: "Realizar X, Após a geração, alterar Y, realizar novamente Z, deverá …". */
function extrairPassosListaDevDoTitulo(titulo) {
  const t = normalizarTitulo(String(titulo || ''));
  const m = t.match(
    /^realizar\s+(?:a|o)\s+(.+?),\s*ap[oó]s\s+a\s+gera[cç][aã]o,\s*alterar\s+(.+?),\s*realizar\s+novamente\s+(.+?),\s*dever[aá]/i
  );
  if (!m) return null;
  const quando = passoGherkin('Quando', `o usuário realiza ${m[1].trim()}`);
  const ePosQuando = [
    passoGherkin('E', `altera ${m[2].trim()}`),
    passoGherkin('E', `realiza novamente ${m[3].trim()}`),
  ].filter(Boolean);
  if (!quando) return null;
  return { quando, ePosQuando };
}

function tituloCenarioDevLista(titulo) {
  const t = normalizarTitulo(String(titulo || ''));
  const m = t.match(/^realizar\s+(?:a|o)\s+(.+?),\s*ap[oó]s/i);
  if (m) {
    const acao = m[1].replace(/\s+com\s+configura[cç][aã]o.+$/i, '').trim();
    return tituloCenarioCurto(`${acao}, respostas diferentes após alterar configuração`);
  }
  return tituloCenarioCurto(t);
}

/**
 * Cenários QA a partir de um bloco Dev (divide se passar de maxE linhas "E").
 * @returns {string[][]}
 */
function cenariosQaAPartirDoDev(bloco, ctx, nomeFuncionalidade) {
  const passosListaDev = extrairPassosListaDevDoTitulo(bloco.title || '');
  const tituloBruto = bloco.title ? normalizarTitulo(bloco.title) : '';
  const titulo = bloco.title
    ? passosListaDev
      ? tituloCenarioDevLista(bloco.title)
      : tituloBruto.length > 96
        ? tituloCenarioCurto(tituloBruto)
        : tituloBruto
    : `${nomeFuncionalidadeCurto(nomeFuncionalidade)} validação`;
  const refDev = bloco.title || null;
  const textoDev = textoBlocoDev(bloco);

  const passosCorpo = extrairQuandoEntaoDoCorpo(bloco.body || textoDev);
  const formatoGwtDev = corpoTemFormatoGwtDev(bloco.body || '');
  const formatoDevEstruturado =
    formatoGwtDev ||
    /descri[cç][ãa]o\s*:|resultado\s+esperado\s*:/i.test(bloco.body || '');

  if (passosCorpo.entao || passosCorpo.entaoList?.length) {
    const { quandoParaBlocoDev } = require('./bdd-rigor');
    const soAssertivo =
      /^resultado\s+esperado\s*:/im.test(bloco.body || '') &&
      !/descri[cç][ãa]o\s*:/i.test(bloco.body || '');
    const quando =
      passosCorpo.quando ||
      (soAssertivo ? quandoAPartirDeAssertivoDev(bloco) : null) ||
      quandoParaBlocoDev(bloco, ctx);
    if (!quando) return [];
    let entoes = fundirEntoesEmUm(
      passosCorpo.entaoList?.length > 0
        ? passosCorpo.entaoList
        : passosCorpo.entao
          ? [passosCorpo.entao]
          : []
    );
    const entaoIncompleto =
      entoes.length === 1 &&
      fraseEhIncompleta(String(entoes[0]).replace(/^\s*ent[aã]o\s+/i, ''));
    if (!entoes.length || entaoIncompleto) {
      const fromTitle = entaoAPartirDoTituloDev(titulo);
      if (fromTitle) entoes = [fromTitle];
    }
    const corpo = [
      ...montarDadosIniciais(ctx),
      ...(passosCorpo.eSteps || []),
      quando,
      ...(passosCorpo.ePosQuando || []),
      ...entoes,
      ...(passosCorpo.ePosEntao || []),
    ];
    return dividirCenarioCompletoPorMaxE(titulo, corpo, { refDev });
  }

  const { entaoParaBlocoDev, quandoParaBlocoDev } = require('./bdd-rigor');
  let entao = entaoParaBlocoDev(ctx, textoDev);
  if (!entao && !formatoDevEstruturado) {
    entao = entaoDoContexto(ctx, textoDev);
  }
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
    !formatoDevEstruturado && bloco.body && limparTexto(bloco.body)
      ? mergePassosFontes(
          bloco.body,
          onlyTitleAndDevSources() ? '' : ctx.passos
        )
      : onlyTitleAndDevSources()
        ? ''
        : mergePassosFontes(ctx.passos, ctx.descricao);

  const chunks = formatoDevEstruturado
    ? []
    : passosParaStepsGherkinComContinuacao(passosMerged);
  if (!chunks.length) {
    const soAssertivo =
      /^resultado\s+esperado\s*:/im.test(bloco.body || '') &&
      !/descri[cç][ãa]o\s*:/i.test(bloco.body || '');
    const quando =
      passosListaDev?.quando ||
      passosCorpo.quando ||
      (soAssertivo ? quandoAPartirDeAssertivoDev(bloco) : null) ||
      quandoParaBlocoDev(bloco, ctx);
    if (!quando) return [];
    const ePos =
      passosListaDev?.ePosQuando?.length > 0
        ? passosListaDev.ePosQuando
        : passosCorpo.ePosQuando || [];
    return dividirCenarioCompletoPorMaxE(
      titulo,
      [...montarDadosIniciais(ctx), quando, ...ePos, entao],
      { refDev }
    );
  }

  return chunks.flatMap((passos, idx) => {
    const suffix = sufixoContinuacaoCenario(idx);
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

/** Extrai Então verificável do título do cenário Dev ("… deve …"). */
function entaoAPartirDoTituloDev(titulo) {
  const t = normalizarTitulo(String(titulo || ''));
  const m = t.match(/\bdever[aá]\s+(.+)$/i);
  if (!m) return null;
  const ev =
    entaoVerificavelDev(`deve ${m[1]}`) ||
    entaoVerificavel(`deve ${m[1]}`) ||
    m[1].trim();
  if (!ev || fraseEhIncompleta(ev)) return null;
  return `  Então ${ev}`;
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
  const titulo = `${nomeCurto} validação principal`;
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
    const suffix = sufixoContinuacaoCenario(idx);
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
  const parsed = parseTituloParaCenario(tituloCard);
  const tituloCenario = parsed
    ? tituloCenarioCurto(limparAspasTitulo(parsed.titulo) || parsed.titulo)
    : tituloCenarioCurto(fluxoPrincipalDoTitulo(tituloCard) || nomeFuncionalidadeCurto(nomeFuncionalidade));
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
  const { detectAmbienteTituloPrioritario } = require('./bdd-ambiente');
  const ambiente =
    detectAmbienteTituloPrioritario(ctx && ctx.titulo) ||
    (ctx && ctx.ambiente) ||
    detectAmbiente(ctx && ctx.titulo, ctx && ctx.cenariosTesteDev);
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
 * Remove prefixos administrativos do título (Squad, Sustentação, Portal…) e retorna o fluxo.
 */
function fluxoPrincipalDoTitulo(titulo) {
  const t = normalizarTitulo(titulo);
  if (!t) return '';
  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  const skip =
    /^(sustenta[çc][aã]o|desenvolvimento(\s+web|\s+desktop)?|portal(\s+mobilemed)?|mobile(\s+i)?|squad|feature|improve(?:ment)?|fix|bug|\s*x\s*)$/i;
  while (partes.length > 1 && skip.test(partes[0])) partes.shift();
  if (partes.length > 1 && /^portal\s+mobilemed(?:\s+improve)?$/i.test(partes[0])) partes.shift();
  let fluxo = partes.join(', ') || t;
  fluxo = fluxo
    .replace(/^portal\s+mobilemed(?:\s+improve)?\s*[-–—]?\s*/i, '')
    .replace(/^improve\s*[-–—]\s*/i, '')
    .trim();
  return fluxo || t;
}

/**
 * Deriva cenário executável a partir do título quando NGF/Dev estão vazios.
 * @returns {{ titulo: string, e?: string, quando: string, entao: string } | null}
 */
function limparAspasTitulo(texto) {
  return String(texto || '')
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB\u2039\u203A""''„]/g, '')
    .trim();
}

function parseTituloParaCenario(titulo) {
  const fluxo = fluxoPrincipalDoTitulo(titulo);
  if (!fluxo || fluxo.length < 12) return null;

  let m = fluxo.match(
    /campo\s+(.+?)\s+obrigat[oó]ri[oa]\s+indevidamente\s+ao\s+selecionar\s+tipo\s+[«""']?(.+?)[»""']?\s+(?:no\s+|em\s+)(.+)/i
  );
  if (m) {
    const campo = m[1].trim();
    const tipo = limparAspasTitulo(m[2]);
    const local = m[3].trim();
    return {
      titulo: `${tipo} no ${local} sem exigir ${campo}`,
      e: `o usuário abre o ${local}`,
      quando: `o usuário seleciona o tipo "${tipo}" no formulário`,
      entao: `o campo ${campo} não é exigido como obrigatório`,
    };
  }

  m = fluxo.match(
    /(.+?)\s+obrigat[oó]ri[oa]\s+indevidamente\s+ao\s+selecionar\s+(.+)/i
  );
  if (m) {
    const alvo = m[1].trim();
    const acao = m[2].trim();
    return {
      titulo: `${alvo} validação ao ${acao}`,
      e: `o usuário acessa a tela citada no chamado`,
      quando: `o usuário ${acao.charAt(0).toLowerCase()}${acao.slice(1)}`,
      entao: `${alvo} não é exigido como obrigatório`,
    };
  }

  m = fluxo.match(/(?:n[aã]o|nao)\s+(exibe|apresenta|permite|salva|sincroniza|envia)\s+(.+)/i);
  if (m) {
    const verbo = m[1].toLowerCase();
    const resto = m[2].trim();
    return {
      titulo: fluxo.slice(0, 90),
      e: `o usuário acessa a funcionalidade citada no chamado`,
      quando: `o usuário reproduz o fluxo descrito no título do chamado`,
      entao: `o sistema ${verbo} ${resto}`,
    };
  }

  m = fluxo.match(/(?:falha|erro|bug)\s+(?:ao|na|no|em)\s+(.+)/i);
  if (m) {
    const acao = m[1].trim();
    return {
      titulo: tituloCenarioCurto(fluxo),
      e: `o usuário acessa a funcionalidade citada no chamado`,
      quando: `o usuário ${acao.charAt(0).toLowerCase()}${acao.slice(1)}`,
      entao: `o fluxo de ${acao} deve ser concluído sem erro de sistema`,
    };
  }

  m = fluxo.match(
    /invalidar\s+cache\s+(?:da\s+)?(?:resposta\s+)?(?:da\s+)?ia(?:\s*,\s*|\s+)quando\s+houver\s+mudan[çc]a\s+(?:no|em)\s+(.+)/i
  );
  if (m) {
    const alvo = m[1].replace(/\s+para\s+(?:a\s+)?empresa\/?usu[aá]rio\s*$/i, '').trim();
    return {
      titulo: 'Invalidar cache da resposta da IA ao alterar painel',
      e: `o usuário acessa o painel da IA${alvo ? ` (${alvo})` : ''}`,
      quando: 'o usuário altera a configuração do painel da IA para a empresa ou usuário',
      entao:
        'a resposta da IA deve refletir a configuração atualizada sem reutilizar cache da configuração anterior',
    };
  }

  m = fluxo.match(/quando\s+houver\s+mudan[çc]a\s+(?:no|em)\s+(.+)/i);
  if (m) {
    const alvo = m[1].trim();
    return {
      titulo: tituloCenarioCurto(fluxo),
      e: `o usuário acessa ${alvo}`,
      quando: `o usuário altera a configuração em ${alvo}`,
      entao: 'o sistema deve refletir a alteração sem reutilizar dados em cache desatualizados',
    };
  }

  return null;
}

function tituloCenarioCurto(texto, max = 88) {
  const t = normalizarTitulo(texto);
  if (!t || t.length <= max) return t;
  const corte = t.slice(0, max);
  const sp = corte.lastIndexOf(' ');
  return (sp > 40 ? corte.slice(0, sp) : corte).trim();
}

/**
 * Quando o card só tem título (campos NGF vazios), monta passos a partir do título.
 */
function passosAPartirDoTitulo(titulo) {
  const parsed = parseTituloParaCenario(titulo);
  if (parsed) {
    const out = [];
    if (parsed.e) out.push(`    E ${parsed.e}`);
    out.push(`  Quando ${parsed.quando}`);
    return out;
  }

  const fluxo = fluxoPrincipalDoTitulo(titulo);
  if (!fluxo) return [];

  const local = fluxo.match(/(?:no|em|na)\s+(cadastro|tela|módulo|formulário|listagem|laudário|worklist|portal)\s+de\s+(\w+)/i);
  if (local) {
    return [
      `    E o usuário abre ${local[0]}`,
      `  Quando o usuário executa o fluxo descrito no título do chamado`,
    ];
  }

  return [`  Quando o usuário executa o fluxo descrito no título do chamado`];
}

function entaoAPartirDoTitulo(titulo) {
  const parsed = parseTituloParaCenario(titulo);
  if (parsed?.entao) {
    const { entaoEhVago } = require('./bdd-rigor');
    if (!entaoEhVago(parsed.entao)) return `  Então ${parsed.entao}`;
  }

  const fluxo = fluxoPrincipalDoTitulo(titulo);
  if (!fluxo) return null;

  if (/obrigat[oó]ri[oa]\s+indevidamente|indevidamente/i.test(fluxo)) {
    const m = fluxo.match(/campo\s+(.+?)\s+obrigat/i);
    if (m) return `  Então o campo ${m[1].trim()} não é exigido como obrigatório`;
    return `  Então o campo citado no chamado não é exigido como obrigatório`;
  }

  if (/n[aã]o\s+(exibe|apresenta|permite|salva)/i.test(fluxo)) {
    const ev = entaoVerificavel(fluxo);
    if (ev) return `  Então ${ev}`;
  }

  const { entaoEhVago } = require('./bdd-rigor');
  const ev = entaoVerificavel(`comportamento descrito no chamado é observado: ${fluxo}`);
  if (ev && !entaoEhVago(ev)) return `  Então ${ev}`;
  return null;
}

/**
 * Reorganiza cenários com mais de maxE linhas "E" em cenários de continuação.
 */
function aplicarLimiteEPorCenarioNaFeature(feature) {
  if (!feature || typeof feature !== 'string') return '';

  const { isLinhaCenario } = require('./bdd-scenario-numbering');
  const RE_TITULO_CENARIO = /^cen[aá]rio\s*(?:\d+\s*)?:\s*/i;

  const linhas = feature.split(/\r?\n/);
  const header = [];
  const cenarios = [];
  let atual = null;

  for (const line of linhas) {
    const trimmed = line.trimEnd();
    if (isLinhaCenario(trimmed)) {
      if (atual) cenarios.push(atual);
      atual = { titulo: trimmed.replace(RE_TITULO_CENARIO, '').trim(), corpo: [] };
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
      const titulo = bloco[0];
      const corpo = dedupeLinhasE(garantirUmEntaoPorCenario(bloco.slice(1)));
      saida.push(titulo, ...corpo, '');
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

    if (/^\s*E\s+cen[aá]rio\s*:/i.test(trimmed)) {
      out.push(trimmed.replace(/^\s*E\s+cen[aá]rio\s*:/i, 'Cenário:'));
      continue;
    }

    const { isLinhaCenario } = require('./bdd-scenario-numbering');
    if (/^funcionalidade\s*:/i.test(trimmed)) {
      const m = trimmed.match(/^(\s*funcionalidade\s*:\s*)(.*)$/i);
      out.push(m ? m[1] + prosaTituloSemTracos(m[2]) : trimmed);
      continue;
    }
    if (isLinhaCenario(trimmed)) {
      const m = trimmed.match(/^(\s*cen[aá]rio\s*(?:\d+\s*)?:\s*)(.*)$/i);
      out.push(m ? m[1] + prosaTituloSemTracos(m[2]) : trimmed);
      continue;
    }

    if (/^\s*dado\s+que\s+/i.test(trimmed) && /o\s+usuário/i.test(trimmed)) {
      out.push(corrigirLinhaDadoAmbiente(trimmed.replace(/^\s*/g, '  ')));
      continue;
    }

    if (/^\s*ent[aã]o\s+/i.test(trimmed)) {
      const fundidos = fundirEntoesEmUm([trimmed]);
      if (fundidos.length) out.push(...fundidos);
      continue;
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
      const m = trimmed.match(/^(\s*#\s*)(.*)$/);
      out.push(m ? m[1] + prosaTituloSemTracos(m[2]) : trimmed);
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
  entaoVerificavelDev,
  objetivarFraseDev,
  quandoAPartirDeAssertivoDev,
  quandoAPartirDeDescricaoDev,
  corpoTemFormatoGwtDev,
  parseSecoesGwtDev,
  montarPassosDeSecoesGwt,
  fraseEhIncompleta,
  passoEhColagemGherkin,
  MAX_ENTAO_CHARS,
  primeiraFrase,
  objetivarFrase,
  passoGherkin,
  passosParaStepsGherkin,
  passosParaStepsGherkinComContinuacao,
  consolidarAcoesObjetivas,
  splitPassosColados,
  acoesParaLinhasGherkin,
  dividirCenarioCompletoPorMaxE,
  comentarioRefCobertura,
  maxEPorCenario,
  maxTotalEPorCenario,
  maxEntaoPorCenarioDev,
  extrairPassosDoTexto,
  desconcatenarPassosColados,
  mergePassosFontes,
  parseCenariosDevBlocos,
  cenarioQaAPartirDoDev,
  cenariosQaAPartirDoDev,
  cenarioPrincipalNgf,
  cenariosPrincipalNgf,
  cenariosSmokeAPartirDoTitulo,
  parseTituloParaCenario,
  fluxoPrincipalDoTitulo,
  tituloCenarioCurto,
  entaoDoContexto,
  devCenariosParaPassosE,
  montarDadosIniciais,
  inferirModuloDoTitulo,
  removerRotulos,
  ctxTemCamposEstruturados,
  passosAPartirDoTitulo,
  entaoAPartirDoTitulo,
  quandoAPartirDeTituloDev,
  extrairPassosListaDevDoTitulo,
  tituloCenarioDevLista,
  resolverPassosReproducao,
  prosaTituloSemTracos,
  sufixoContinuacaoCenario,
  sanitizarFeatureBdd,
  aplicarLimiteEPorCenarioNaFeature,
  garantirUmEntaoPorCenario,
  compactarCorpoCenario,
  passoEhColagemDescricao,
};
