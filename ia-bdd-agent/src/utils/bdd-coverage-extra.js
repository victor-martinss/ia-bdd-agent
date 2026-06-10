const { detectAmbiente, dadoAcessaAmbiente } = require('./bdd-ambiente');
const {
  limparTexto,
  passosParaStepsGherkin,
  nomeFuncionalidadeCurto,
  comentarioRefCobertura,
  entaoVerificavelDev,
  fraseEhIncompleta,
} = require('./bdd-gherkin');
const { extrairValidacoesExatas } = require('./bdd-validacoes');

function coverageExtraEnabled() {
  return process.env.BDD_COVERAGE_EXTRA !== '0';
}

function maxCenariosExtras() {
  const n = Number.parseInt(process.env.BDD_COVERAGE_MAX_EXTRA || '2', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 6) : 2;
}

/** Máximo de cenários complementares após espelhar todos os blocos Dev. */
function maxCenariosExtrasAposDev(qtdDev) {
  const base = maxCenariosExtras();
  if (qtdDev <= 0) return base;
  const ratio = Number.parseFloat(process.env.BDD_COVERAGE_EXTRA_RATIO || '0.5');
  const porRatio =
    Number.isFinite(ratio) && ratio > 0
      ? Math.ceil(qtdDev * ratio)
      : Math.max(1, Math.floor(qtdDev / 2));
  const minExtra = Number.parseInt(process.env.BDD_COVERAGE_MIN_EXTRA_AFTER_DEV || '1', 10);
  const minOk = Number.isFinite(minExtra) && minExtra >= 0 ? minExtra : 1;
  return Math.min(6, Math.max(minOk, porRatio, base));
}

function coverageExtraAposDevEnabled() {
  if (process.env.BDD_COVERAGE_EXTRA_AFTER_DEV === '0') return false;
  return coverageExtraEnabled();
}

/** Pontua candidatos de cobertura — maior = mais alinhado ao risco do chamado. */
function pontuarCoberturaExtra(titulo, ctx, textoConsolidadoLower) {
  const t = titulo.toLowerCase();
  const tags = ctx.palavrasChaveTeste || [];
  let score = 0;

  if (/consist|integr|entre\s+sistemas/.test(t)) {
    if (tags.includes('integracao') || (textoConsolidadoLower.includes('worklist') && textoConsolidadoLower.includes('portal'))) {
      score = 95;
    } else score = 20;
  } else if (/inv[aá]lid|negativ|valida/.test(t)) {
    if (/\b(cupom|login|senha|formul|campo\s+obrigat)/i.test(textoConsolidadoLower)) score = 70;
    else if (tags.includes('valid')) score = 45;
    else score = 15;
  } else if (/interrup/.test(t)) {
    if (/\b(laud[aá]rio|grava[çc]|áudio|reprodu)/i.test(textoConsolidadoLower)) score = 65;
    else if (/\b(exportar|salvar|enviar)\b/i.test(textoConsolidadoLower)) score = 40;
    else score = 10;
  } else if (/permiss/.test(t)) {
    if (tags.includes('permiss') || /\bperfil\b/i.test(textoConsolidadoLower)) score = 75;
    else score = 5;
  } else if (/lista\s+vazia|sem\s+registro/.test(t)) {
    if (/\b(filtro|pesquisa|sem\s+registro|nenhum\s+resultado)\b/i.test(textoConsolidadoLower)) score = 55;
    else score = 8;
  } else if (/smoke|acesso/.test(t)) {
    score = 12;
  }

  if (ctx.qaHistorico?.isRetornoQa && /smoke|acesso/.test(t)) score = Math.max(0, score - 40);
  if (ctx.resultadoObtido && /smoke/.test(t)) score = Math.max(0, score - 30);

  return score;
}

function textoConsolidado(ctx, blocosDev) {
  const partes = [
    ctx.titulo,
    ctx.descricaoFiltrada || ctx.descricao,
    ctx.passosFiltrados || ctx.passos,
    ctx.resultadoEsperado,
    ctx.resultadoObtido,
    ctx.evidenceResumoFiltrado || ctx.evidenceResumo,
    ctx.observacoesTriagemFiltrada || ctx.observacoesTriagem,
    ctx.cenariosTesteDev,
    ...(blocosDev || []).map((b) => `${b.title || ''}\n${b.body || ''}`),
  ];
  return partes.join('\n').toLowerCase();
}

/** Somente campos NGF/evidências analisados (sem Cenários Dev) — gatilho de cobertura extra. */
function textoCamposAnalisados(ctx) {
  return [
    ctx.titulo,
    ctx.descricaoFiltrada || ctx.descricao,
    ctx.passosFiltrados || ctx.passos,
    ctx.resultadoEsperado,
    ctx.resultadoObtido,
    ctx.evidenceResumoFiltrado || ctx.evidenceResumo,
    ctx.observacoesTriagemFiltrada || ctx.observacoesTriagem,
    ctx.comentariosTarefaFiltrado || ctx.comentariosTarefa,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function temCamposNgfParaCobertura(ctx) {
  return !!(
    limparTexto(ctx.passosFiltrados || ctx.passos) ||
    limparTexto(ctx.descricaoFiltrada || ctx.descricao) ||
    limparTexto(ctx.resultadoEsperado) ||
    limparTexto(ctx.resultadoObtido) ||
    limparTexto(ctx.evidenceResumoFiltrado || ctx.evidenceResumo)
  );
}

function entaoExtraAssertivo(ctx, fallback) {
  if (process.env.BDD_ASSERTIVE_MODE === '0') return fallback;
  const vals = extrairValidacoesExatas(ctx);
  if (vals.length) return `  Então ${vals[0].entao}`;
  return fallback;
}

function devJaCobre(todosBlocos, padroes) {
  const blob = textoConsolidado({ cenariosTesteDev: '' }, todosBlocos);
  return padroes.some((p) => p.test(blob));
}

function montarCenarioExtra(titulo, ctx, passosTexto, entao, refRelacionada = null) {
  const linhas = [
    `Cenário: ${titulo}`,
    ...comentarioRefCobertura(refRelacionada || ctx.titulo, { fase: 'cobertura complementar' }),
    dadoAcessaAmbiente(ctx.ambiente || detectAmbiente(ctx.titulo, ctx.cenariosTesteDev)),
  ];
  const quando = passosParaStepsGherkin(passosTexto);
  if (!quando.length) return null;
  linhas.push(...quando);
  if (!entao || /comportamento esperado é observado/i.test(entao)) return null;
  const corpoEntao = entao.replace(/^\s*ent[aã]o\s+/i, '').trim();
  if (fraseEhIncompleta(corpoEntao)) return null;
  linhas.push(entao);
  return linhas;
}

/**
 * Cenários QA complementares (além dos blocos do campo Cenários Dev).
 * @param {object} ctx
 * @param {{ title: string|null, body: string, lines: string[] }[]} blocosDev
 * @param {string} nomeFuncionalidade
 * @returns {string[][]} lista de linhas por cenário
 */
function gerarCenariosCoberturaExtra(ctx, blocosDev, nomeFuncionalidade) {
  if (!coverageExtraEnabled()) return [];

  const qtdDev = (blocosDev || []).length;
  const comDev = qtdDev > 0;

  if (comDev && !coverageExtraAposDevEnabled()) return [];

  if (
    !comDev &&
    limparTexto(ctx.passosFiltrados || ctx.passos) &&
    ctx.resultadoObtido &&
    ctx.resultadoEsperado
  ) {
    return [];
  }

  if (!comDev && !temCamposNgfParaCobertura(ctx)) return [];

  const max = comDev ? maxCenariosExtrasAposDev(qtdDev) : maxCenariosExtras();
  if (max <= 0) return [];

  const candidatos = [];
  const t = textoCamposAnalisados(ctx);
  const blobDev = textoConsolidado(ctx, blocosDev);
  const foco = nomeFuncionalidadeCurto(nomeFuncionalidade);
  const amb = ctx.ambiente || detectAmbiente(ctx.titulo, ctx.cenariosTesteDev);

  const temFluxoPrincipal =
    blocosDev.length > 0 ||
    limparTexto(ctx.passosFiltrados || ctx.passos) ||
    limparTexto(ctx.descricaoFiltrada || ctx.descricao);

  if (
    !temFluxoPrincipal &&
    !devJaCobre(blocosDev, [/smoke/i, /acesso\s+ao\s+ambiente/i, /acesso\s+inicial/i])
  ) {
    const linhasSmoke = montarCenarioExtra(
      `Cobertura — smoke de acesso (${amb.label})`,
      ctx,
      `o usuário acessa a tela principal de ${foco}`,
      entaoExtraAssertivo(
        ctx,
        `  Então a tela principal de ${amb.label} é exibida sem mensagem de erro de sistema`
      )
    );
    if (linhasSmoke) {
      candidatos.push({ score: 10, linhas: linhasSmoke });
    }
  }

  if (
    (t.includes('worklist') && t.includes('portal')) ||
    (t.includes('protocolo') && (t.includes('sincron') || t.includes('compar')))
  ) {
    if (!devJaCobre(blocosDev, [/compar/i, /sincron/i, /entre\s+.*portal/i])) {
      const linhasInteg = montarCenarioExtra(
        'Cobertura — consistência entre sistemas',
        ctx,
        'registrar o valor exibido no primeiro sistema\nabrir o mesmo registro no segundo sistema\ncomparar o mesmo campo entre os dois ambientes',
        '  Então os dados exibidos são consistentes entre os ambientes consultados'
      );
      if (linhasInteg) {
        candidatos.push({
          score: pontuarCoberturaExtra('Cobertura — consistência entre sistemas', ctx, t),
          linhas: linhasInteg,
        });
      }
    }
  }

  if (
    !devJaCobre(blocosDev, [/inv[aá]lid/i, /negativ/i, /erro\s+de\s+valida/i, /campo\s+obrigat/i]) &&
    !ctx.resultadoObtido?.match(/protocolo|associa|sincron|entre\s+sistemas/i)
  ) {
    if (/\b(cupom|login|senha|formul[aá]rio|campo\s+obrigat|cupom)\b/i.test(t)) {
      const linhasVal = montarCenarioExtra(
        'Cobertura — validação com dado inválido',
        ctx,
        ctx.passosFiltrados || ctx.passos,
        entaoExtraAssertivo(
          ctx,
          '  Então uma mensagem de validação é exibida e o fluxo não conclui incorretamente'
        )
      );
      if (linhasVal) {
        candidatos.push({
          score: pontuarCoberturaExtra('Cobertura — validação com dado inválido', ctx, t),
          linhas: linhasVal,
        });
      }
    }
  }

  if (
    comDev &&
    !devJaCobre(blocosDev, [/cancel/i, /interromp/i, /sair\s+sem/i, /fechar\s+sem/i])
  ) {
    if (/\b(laud[aá]rio|grava[çc][aã]o|áudio|reprodu)/i.test(t)) {
      const linhasInt = montarCenarioExtra(
        'Cobertura — interrupção do fluxo',
        ctx,
        ctx.passosFiltrados || ctx.passos,
        entaoExtraAssertivo(ctx, '  Então nenhuma mensagem de erro é exibida ao sair do fluxo')
      );
      if (linhasInt) {
        candidatos.push({
          score: pontuarCoberturaExtra('Cobertura — interrupção do fluxo', ctx, t),
          linhas: linhasInt,
        });
      }
    }
  }

  if (!devJaCobre(blocosDev, [/permiss[aã]o|n[aã]o\s+autorizado|acesso\s+negado/i])) {
    if (/\b(perfil|permiss[aã]o|usu[aá]rio\s+sem)\b/i.test(t)) {
      const linhasPerm = montarCenarioExtra(
        'Cobertura — usuário sem permissão',
        ctx,
        'acessar o módulo com usuário de perfil restrito\ntentar executar a ação do chamado',
        '  Então o acesso é bloqueado ou a ação não é permitida conforme regra de perfil'
      );
      if (linhasPerm) {
        candidatos.push({
          score: pontuarCoberturaExtra('Cobertura — usuário sem permissão', ctx, t),
          linhas: linhasPerm,
        });
      }
    }
  }

  if (
    !devJaCobre(blocosDev, [/lista\s+vazia|nenhum\s+registro|sem\s+exame|edge/i]) &&
    /\b(filtro|pesquisa|sem\s+registro|nenhum\s+resultado)\b/i.test(t) &&
    !blobDev.includes('lista vazia')
  ) {
    const linhasLista = montarCenarioExtra(
      'Cobertura — lista sem registros',
      ctx,
      'aplicar filtro que não retorna resultados\nvisualizar a área de listagem',
      '  Então é exibido estado vazio ou mensagem informativa sem erro de sistema'
    );
    if (linhasLista) {
      candidatos.push({
        score: pontuarCoberturaExtra('Cobertura — lista sem registros', ctx, t),
        linhas: linhasLista,
      });
    }
  }

  const vistos = new Set();
  const limiarScoreFinal = comDev ? 45 : 60;
  if (limparTexto(ctx.comentariosTarefaFiltrado || ctx.comentariosTarefa)) {
    const comentario = (ctx.comentariosTarefaFiltrado || ctx.comentariosTarefa).trim();
    const frases = comentario
      .split(/(?<=[.!?])\s+|\n+/)
      .map((f) => f.trim())
      .filter((f) => f.length > 20 && /deve|validar|testar|verificar|cen[aá]rio|fluxo|erro|mensagem/i.test(f));
    for (const frase of frases.slice(0, max)) {
      const ev = entaoVerificavelDev(frase.replace(/^deve\s+/i, ''));
      if (!ev || fraseEhIncompleta(ev)) continue;
      const tituloExtra = `Cobertura — comentário da tarefa`;
      const linhasCom = montarCenarioExtra(
        tituloExtra,
        ctx,
        ctx.passosFiltrados || ctx.passos || frase,
        entaoExtraAssertivo(ctx, `  Então ${ev}`)
      );
      if (linhasCom) {
        candidatos.push({
          score: 72,
          linhas: linhasCom,
        });
      }
    }
  }

  const ranqueados = candidatos
    .filter((c) => Array.isArray(c.linhas) && c.linhas.length > 0)
    .map((c) => ({
      ...c,
      score: c.score ?? pontuarCoberturaExtra((c.linhas[0] || '').replace(/^Cenário:\s*/i, ''), ctx, t),
    }))
    .filter((c) => c.score >= limiarScoreFinal)
    .sort((a, b) => b.score - a.score);

  const unicos = [];
  for (const c of ranqueados) {
    const linhas = c.linhas;
    if (!Array.isArray(linhas) || !linhas.length) continue;
    const titulo = (linhas[0] || '').replace(/^Cenário:\s*/i, '').trim();
    if (vistos.has(titulo)) continue;

    const entaoLinha = linhas.find((l) => /^\s*então\s+/i.test(l)) || '';
    const entaoNorm = entaoLinha.replace(/^\s*então\s+/i, '').toLowerCase().slice(0, 50);
    if (entaoNorm && blobDev.includes(entaoNorm.slice(0, 30))) continue;

    vistos.add(titulo);
    unicos.push(linhas);
    if (unicos.length >= max) break;
  }

  return unicos;
}

/**
 * Cabeçalho informativo (comentário Gherkin) sobre cobertura.
 */
function cabecalhoCobertura(qtdDev, qtdExtra) {
  const { bddInternalCommentsEnabled } = require('./bdd-crm-merge');
  if (!bddInternalCommentsEnabled()) return '';
  if (!coverageExtraEnabled() || qtdExtra === 0) {
    return `# Cenários QA: ${qtdDev} baseado(s) em Cenários Dev\n`;
  }
  return (
    `# Cenários QA: ${qtdDev} do campo Cenários Dev + ${qtdExtra} complementar(es) de cobertura\n`
  );
}

module.exports = {
  coverageExtraEnabled,
  maxCenariosExtras,
  gerarCenariosCoberturaExtra,
  cabecalhoCobertura,
  textoConsolidado,
  montarCenarioExtra,
};
