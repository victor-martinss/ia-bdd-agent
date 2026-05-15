/**
 * Transforma textos do CRM em passos Gherkin objetivos (Dado / Quando / Então / E).
 */

function limparTexto(s) {
  if (s == null || s === '') return '';
  return String(s)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '');
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

/** Frase curta e testável, sem colar parágrafos do chamado. */
function objetivarFrase(frase, maxLen = 220) {
  let f = removerRotulos(frase);
  if (!f) return '';

  f = f
    .replace(/^(mesmo\s+com|apesar\s+de|quando|se)\s+/i, '')
    .replace(/^o\s+usuário\s+/i, '')
    .replace(/^que\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!f) return '';

  const verbosAcao =
    /^(informa|clica|acessa|envia|visualiza|preenche|seleciona|abre|cadastra|exporta|tenta|cadastrar|enviar|verificar|clicar|informar|acessar|visualizar|preencher|selecionar|abrir|exportar)/i;
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
      .replace(/^tentar\b/i, 'tenta');
    if (!/^o usuário\s/i.test(f)) {
      f = `o usuário ${f.charAt(0).toLowerCase()}${f.slice(1)}`;
    }
  }

  if (f.length > maxLen) {
    const cortada = f.slice(0, maxLen);
    const ultimoEspaco = cortada.lastIndexOf(' ');
    f = (ultimoEspaco > 40 ? cortada.slice(0, ultimoEspaco) : cortada).trim();
  }

  f = f.replace(/[.!?]+$/g, '').trim();
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
 * Divide passos em frases e gera Quando / E.
 * @param {string} passos
 * @param {{ maxLinhas?: number }} [opts]
 */
function passosParaStepsGherkin(passos, opts = {}) {
  const max =
    Number.parseInt(process.env.BDD_MAX_PASSO_LINES || '12', 10) || 12;
  const maxLinhas = opts.maxLinhas ?? max;

  if (!passos || !limparTexto(passos)) {
    return ['  Quando o usuário executa o fluxo principal do chamado'];
  }

  const partes = removerRotulos(passos)
    .split(/\n+|(?<=[.!?])\s+|;\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 2);

  if (!partes.length) {
    return ['  Quando o usuário executa o fluxo principal do chamado'];
  }

  const linhas = [];
  partes.slice(0, Math.max(1, maxLinhas)).forEach((p, i) => {
    const corpo = objetivarFrase(p);
    if (!corpo) return;
    if (i === 0) linhas.push(`  Quando ${corpo}`);
    else linhas.push(`    E ${corpo}`);
  });
  return linhas.length ? linhas : ['  Quando o usuário executa o fluxo principal do chamado'];
}

function linhaJaEhGherkin(line) {
  return /^\s*(dado|quando|então|entao|e)\s/i.test(line);
}

function normalizarLinhaGherkin(line) {
  const t = line.trim();
  const m = t.match(/^(dado|quando|então|entao|e)\s*(que\s+)?(.+)$/i);
  if (!m) return null;
  const tipo = m[1].toLowerCase();
  const resto = objetivarFrase(m[3] || '');
  if (!resto) return null;
  if (tipo === 'dado') return `  Dado que ${resto}`;
  if (tipo === 'quando') return `  Quando ${resto}`;
  if (tipo === 'entao' || tipo === 'então') return `  Então ${resto}`;
  return `    E ${resto}`;
}

/**
 * Converte bloco "Cenários de Teste (Dev)" em passos E (não cola o bloco inteiro).
 */
function devCenariosParaPassosE(texto) {
  if (!texto || !limparTexto(texto)) return [];

  const linhas = [];
  for (const raw of texto.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.length < 3) continue;
    line = line.replace(/^\d+[\).\]]\s*/, '').replace(/^[-*•]\s*/, '');

    if (linhaJaEhGherkin(line)) {
      const norm = normalizarLinhaGherkin(line);
      if (norm) {
        if (norm.startsWith('  Dado') || norm.startsWith('  Quando') || norm.startsWith('  Então')) {
          linhas.push(`    E o cenário do dev prevê: ${norm.replace(/^\s+/, '').toLowerCase()}`);
        } else {
          linhas.push(norm);
        }
      }
      continue;
    }

    const obj = objetivarFrase(line);
    if (obj) linhas.push(`    E ${obj}`);
  }

  return linhas.slice(0, 15);
}

/**
 * Resume a descrição como pré-condição (evita colar o defeito inteiro no Dado).
 */
function precondicaoDaDescricao(descricao) {
  if (!descricao || !limparTexto(descricao)) return '';

  const comMesmo = descricao.match(
    /(?:mesmo\s+com|com)\s+(.+?)(?:,|\s+o\s+|\s+que\s+|$)/i
  );
  if (comMesmo && comMesmo[1]) {
    const prep = objetivarFrase(comMesmo[1]);
    if (prep) return prep;
  }

  const frase = primeiraFrase(descricao);
  if (/gera|apresenta|não|nao|em vez|invés|falha|erro/i.test(frase)) {
    return '';
  }
  return objetivarFrase(frase);
}

function montarDadosIniciais(ctx) {
  const out = ['  Dado que o sistema está em operação'];
  const ctxResumo = ctx.descricao ? precondicaoDaDescricao(ctx.descricao) : '';
  if (ctxResumo) out.push(`    E ${ctxResumo}`);
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

/**
 * Quando o card só tem título (campos NGF vazios), monta passos a partir do título.
 */
function passosAPartirDoTitulo(titulo) {
  const t = limparTexto(titulo);
  if (!t) return passosParaStepsGherkin('');

  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  const modulo = partes[0] || t;
  const fluxo = partes.length > 1 ? partes.slice(1).join(' — ') : t;

  const linhas = [
    `    E o usuário acessa o fluxo "${modulo}"`,
    `  Quando executa o cenário "${objetivarFrase(fluxo) || fluxo}"`,
  ];
  return linhas;
}

function entaoAPartirDoTitulo(titulo) {
  const t = limparTexto(titulo);
  if (!t) return '  Então o comportamento deve estar alinhado à regra de negócio do chamado';
  const partes = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
  const alvo = partes.length > 1 ? partes.slice(1).join(' ') : t;
  const obj = objetivarFrase(`o sistema deve concluir o fluxo "${alvo}" com sucesso`);
  return obj ? `  Então ${obj}` : `  Então o fluxo "${t}" deve ser concluído com sucesso`;
}

module.exports = {
  limparTexto,
  primeiraFrase,
  objetivarFrase,
  passoGherkin,
  passosParaStepsGherkin,
  devCenariosParaPassosE,
  montarDadosIniciais,
  removerRotulos,
  ctxTemCamposEstruturados,
  passosAPartirDoTitulo,
  entaoAPartirDoTitulo,
};
