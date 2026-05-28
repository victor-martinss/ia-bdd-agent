const { limparTexto } = require('./bdd-gherkin');
const { extrairValidacoesExatas } = require('./bdd-validacoes');
const { textoConsolidado, montarCenarioExtra } = require('./bdd-coverage-extra');

function plannerEnabled() {
  return process.env.BDD_SCENARIO_PLANNER !== '0';
}

function normalizarTexto(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(
    normalizarTexto(s)
      .split(' ')
      .filter((w) => w.length > 3)
  );
}

function similaridade(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) {
    if (tb.has(w)) inter += 1;
  }
  return inter / Math.max(ta.size, tb.size);
}

/**
 * @param {string} feature
 * @returns {{ header: string[], cenarios: { titulo: string, linhas: string[], texto: string }[] }}
 */
function parseFeatureEmCenarios(feature) {
  if (!feature || typeof feature !== 'string') {
    return { header: [], cenarios: [] };
  }

  const linhas = feature.split(/\r?\n/);
  const header = [];
  const cenarios = [];
  let atual = null;

  for (const line of linhas) {
    const trimmed = line.trimEnd();
    if (/^cenário\s*:/i.test(trimmed)) {
      if (atual) cenarios.push(atual);
      const titulo = trimmed.replace(/^cenário\s*:\s*/i, '').trim();
      atual = { titulo, linhas: [trimmed], texto: '' };
      continue;
    }
    if (!atual) {
      header.push(line);
      continue;
    }
    if (trimmed) atual.linhas.push(line);
  }
  if (atual) cenarios.push(atual);

  for (const c of cenarios) {
    c.texto = c.linhas.join('\n');
  }
  return { header, cenarios };
}

function extrairEntao(cenario) {
  const m = cenario.linhas.find((l) => /^\s*então\s+/i.test(l.trim()));
  return m ? m.trim() : '';
}

function extrairQuando(cenario) {
  const m = cenario.linhas.find((l) => /^\s*quando\s+/i.test(l.trim()));
  return m ? m.trim() : '';
}

function normalizarEntao(cenario) {
  return normalizarTexto(extrairEntao(cenario).replace(/^\s*ent[aã]o\s+/i, ''));
}

function normalizarQuando(cenario) {
  return normalizarTexto(extrairQuando(cenario).replace(/^\s*quando\s+/i, ''));
}

function cenarioEhSomenteMeta(cenario) {
  const t = normalizarTexto(cenario.titulo);
  return /automa[çc][aã]o|testes?\s+unit|somente\s+ci\b/.test(t);
}

const ROTULOS_DISTINTOS = [
  'enviados',
  'recebidos',
  'todos',
  'sem filtro',
  'compartilhamento',
  'empresas',
  'performance',
  'regressao',
  'meus exames',
  'atencao',
  'filtro todos',
  'nova aba',
  'tabela',
];

function rotuloDistintoDoTitulo(titulo) {
  const t = normalizarTexto(titulo);
  return ROTULOS_DISTINTOS.find((k) => t.includes(k)) || '';
}

function cenariosTemRotulosDistintos(cen, prev) {
  const r1 = rotuloDistintoDoTitulo(cen.titulo);
  const r2 = rotuloDistintoDoTitulo(prev.titulo);
  return r1 && r2 && r1 !== r2;
}

function cenariosSaoRedundantes(cen, prev, limiar) {
  if (cenariosTemRotulosDistintos(cen, prev)) return false;

  const simTitulo = similaridade(cen.titulo, prev.titulo);
  const entaoA = normalizarEntao(cen);
  const entaoB = normalizarEntao(prev);
  const simEntao = similaridade(entaoA, entaoB);

  if (simTitulo >= limiar && simEntao >= limiar - 0.1) return true;
  if (simEntao >= limiar && simTitulo >= 0.5) return true;

  if (entaoA.length >= 24 && entaoB.length >= 24) {
    const fragA = entaoA.slice(0, 50);
    const fragB = entaoB.slice(0, 50);
    if (
      (entaoA.includes(fragB) || entaoB.includes(fragA)) &&
      simTitulo >= 0.55 &&
      simEntao >= 0.72
    ) {
      return true;
    }
  }

  const quandoA = normalizarQuando(cen);
  const quandoB = normalizarQuando(prev);
  if (
    quandoA &&
    quandoB &&
    similaridade(quandoA, quandoB) >= limiar + 0.06 &&
    simEntao >= 0.62
  ) {
    return true;
  }

  const httpA = entaoA.match(/\b(403|400|404|200|401)\b/);
  const httpB = entaoB.match(/\b(403|400|404|200|401)\b/);
  if (
    httpA &&
    httpB &&
    httpA[1] === httpB[1] &&
    simTitulo >= 0.72 &&
    simEntao >= 0.65 &&
    /post|get|rota|endpoint|api/i.test(cen.titulo + prev.titulo)
  ) {
    return true;
  }

  if (/^cobertura\s*—/i.test(cen.titulo) && simEntao >= 0.62) return true;

  return false;
}

function classificarCenario(cenario, ctx) {
  const t = normalizarTexto(cenario.titulo);
  const blob = normalizarTexto(cenario.texto);
  const tags = ctx.palavrasChaveTeste || [];

  let score = 50;

  if (/defeito|reprodu|obtido|incorreto|bug/.test(t) || /defeito|obtido/.test(blob)) {
    score = 5;
  } else if (/valida[cç][aã]o\s+principal|fluxo\s+principal/.test(t)) {
    score = 15;
  } else if (!/cobertura\s*—/.test(t)) {
    score = 25;
  } else if (/smoke|acesso/.test(t)) {
    score = 35;
  } else if (/consist|integr|compar|sincron/.test(t) || tags.includes('integracao')) {
    score = 40;
  } else if (/inv[aá]lid|negativ|valida/.test(t)) {
    score = 55;
  } else if (/interrup|cancel/.test(t)) {
    score = 70;
  } else if (/permiss/.test(t)) {
    score = 75;
  } else if (/lista\s+vazia|sem\s+registro/.test(t)) {
    score = 80;
  } else if (/cobertura/.test(t)) {
    score = 60;
  }

  if (ctx.qaHistorico?.isRetornoQa) {
    if (score >= 35 && score <= 60 && /smoke|acesso/.test(t)) score += 15;
    if (score <= 30) score -= 5;
  }

  if (ctx.resultadoObtido && /defeito|reprodu/.test(blob)) score -= 8;

  const idxDev = (ctx._ordemDev || []).findIndex((d) => similaridade(d, t) > 0.55);
  if (idxDev >= 0) score = Math.min(score, 20 + idxDev);

  return score;
}

function contarBlocosDev(ctx, meta = {}) {
  if (Number.isFinite(meta.qtdDev) && meta.qtdDev >= 0) return meta.qtdDev;
  if (Array.isArray(ctx._ordemDev) && ctx._ordemDev.length) return ctx._ordemDev.length;
  const dev = String(ctx.cenariosTesteDev || '');
  if (!dev.trim()) return 0;
  if (/^#{1,3}\s+/m.test(dev)) {
    const { parseCenariosDevBlocos } = require('./bdd-gherkin');
    return parseCenariosDevBlocos(dev).length;
  }
  const matches = dev.match(/^\s*(?:cenário|cenario)\s*:/gim);
  return matches ? matches.length : dev.trim() ? 1 : 0;
}

/**
 * Teto opcional de cenários por feature (só se BDD_MAX_SCENARIOS estiver definido).
 * Sem variável: sem limite — redundâncias são removidas por dedup.
 */
function maxTotalCenarios() {
  const fromEnv = Number.parseInt(process.env.BDD_MAX_SCENARIOS || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv >= 1) return fromEnv;
  return Infinity;
}

function removerCenariosRedundantes(cenarios, ctx) {
  const limiar =
    Number.parseFloat(process.env.BDD_DEDUP_SIMILARITY || '0.62') || 0.62;
  const kept = [];
  const removidos = [];

  for (const cen of cenarios) {
    if (cenarioEhSomenteMeta(cen)) {
      removidos.push(cen.titulo);
      continue;
    }

    let duplicata = false;
    for (const prev of kept) {
      if (!cenariosSaoRedundantes(cen, prev, limiar)) continue;

      const scoreCen = classificarCenario(cen, ctx);
      const scorePrev = classificarCenario(prev, ctx);
      if (scoreCen < scorePrev) {
        duplicata = true;
        removidos.push(cen.titulo);
        break;
      }
      const idx = kept.indexOf(prev);
      kept.splice(idx, 1);
      removidos.push(prev.titulo);
      break;
    }
    if (!duplicata) kept.push(cen);
  }

  return { cenarios: kept, removidos };
}

function devJaCobreTexto(blob, padroes) {
  return padroes.some((p) => p.test(blob));
}

/**
 * Lacunas: validações do chamado sem Então correspondente nos cenários gerados.
 * @returns {string[][]}
 */
function gerarCenariosLacunas(ctx, cenariosExistentes, meta = {}) {
  if (process.env.BDD_GAP_SCENARIOS === '0') return [];

  const qtdDev = contarBlocosDev(ctx, meta);
  if (qtdDev > 0) return [];

  const { ctxTemCamposEstruturados } = require('./bdd-gherkin');
  if (!ctxTemCamposEstruturados(ctx)) return [];

  const blob = cenariosExistentes.map((c) => c.texto).join('\n').toLowerCase();
  const camposNgf = [
    ctx.descricaoFiltrada || ctx.descricao,
    ctx.passosFiltrados || ctx.passos,
    ctx.resultadoEsperado,
    ctx.resultadoObtido,
    ctx.evidenceResumoFiltrado || ctx.evidenceResumo,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  const lacunas = [];
  const max = Number.parseInt(process.env.BDD_GAP_MAX || '1', 10) || 1;
  const temDefeito = devJaCobreTexto(blob, [/defeito|obtido|incorreto|mas\s+o\s+esperado/i]);

  const validacoes = extrairValidacoesExatas(ctx);
  for (const v of validacoes) {
    if (v.origem.includes('obtido') && temDefeito) continue;
    if (v.origem.includes('descri') && temDefeito) continue;
    if (
      v.origem.includes('esperado') &&
      devJaCobreTexto(blob, [/valida[cç][aã]o\s+principal|então|protocolo|associar|comparar/i])
    ) {
      const fragEsp = normalizarTexto(v.entao).slice(0, 30);
      if (fragEsp && blob.includes(fragEsp.slice(0, 20))) continue;
    }
    const frag = normalizarTexto(v.entao).slice(0, 40);
    if (frag.length < 8) continue;
    if (blob.includes(frag.slice(0, 25))) continue;
    lacunas.push(
      montarCenarioExtra(
        `Lacuna — ${v.origem.slice(0, 40)}`,
        ctx,
        (ctx.passosObjetivos || []).slice(0, 3).join('\n') || ctx.passosFiltrados || ctx.passos,
        `  Então ${v.entao}`
      )
    );
    if (lacunas.length >= max) break;
  }

  if (lacunas.length < max && ctx.resultadoObtido && !temDefeito) {
    const { entaoVerificavel } = require('./bdd-gherkin');
    const ev = entaoVerificavel(ctx.resultadoObtido);
    if (ev) {
      lacunas.push(
        montarCenarioExtra(
          'Lacuna — reprodução do defeito reportado',
          ctx,
          ctx.passosFiltrados || ctx.passos,
          `  Então ${ev}`
        )
      );
    }
  }

  if (
    lacunas.length < max &&
    camposNgf.includes('worklist') &&
    camposNgf.includes('portal') &&
    !devJaCobreTexto(blob, [/compar|sincron|consist/i])
  ) {
    lacunas.push(
      montarCenarioExtra(
        'Lacuna — comparar dado entre worklist e portal',
        ctx,
        'localizar o mesmo registro na worklist\nabrir o mesmo registro no portal\ncomparar o campo citado no chamado',
        '  Então o valor exibido é o mesmo entre worklist e portal'
      )
    );
  }

  return lacunas.slice(0, max);
}

function ordenarCenarios(cenarios, ctx) {
  return [...cenarios].sort((a, b) => {
    const sa = classificarCenario(a, ctx);
    const sb = classificarCenario(b, ctx);
    if (sa !== sb) return sa - sb;
    return a.titulo.localeCompare(b.titulo, 'pt-BR');
  });
}

function extrairMapaCoberturaDev(cenarios) {
  const mapa = [];
  for (const cen of cenarios) {
    const ref = (cen.linhas || []).find((l) => /^#\s*cobertura\s+dev\s*:/i.test(l.trim()));
    if (!ref) continue;
    const dev = ref.replace(/^#\s*cobertura\s+dev\s*:\s*/i, '').trim();
    const tituloQa = cen.titulo.replace(/\s*—\s*(continuação|fase).*$/i, '').trim();
    if (dev && tituloQa && !mapa.some((m) => m.dev === dev && m.qa === tituloQa)) {
      mapa.push({ dev, qa: tituloQa });
    }
  }
  return mapa;
}

function montarCabecalhoPlano(ctx, qtdDev, qtdExtra, qtdLacunas, removidos, cenarios = []) {
  const linhas = [];
  const partes = [`${qtdDev} do Dev`];
  if (qtdExtra) partes.push(`${qtdExtra} cobertura`);
  if (qtdLacunas) partes.push(`${qtdLacunas} lacuna(s)`);
  linhas.push(`# Cenários QA: ${partes.join(' + ')} — ordem por risco/criticidade`);
  if (ctx.resumoObjetivo) {
    linhas.push(`# ${ctx.resumoObjetivo}`);
  }
  const mapa = extrairMapaCoberturaDev(cenarios);
  if (mapa.length) {
    const resumo = mapa
      .slice(0, 8)
      .map((m) => `${m.qa} ← Dev: ${m.dev}`)
      .join('; ');
    linhas.push(`# Mapa cobertura: ${resumo}`);
  }
  if (removidos.length) {
    linhas.push(`# Redundantes removidos: ${removidos.slice(0, 6).join('; ')}`);
  }
  return linhas;
}

/**
 * Pós-processa feature: deduplica, ordena, injeta lacunas, atualiza cabeçalho.
 * @param {string} feature
 * @param {object} ctx
 * @param {{ qtdDev?: number }} meta
 */
function planificarFeatureBdd(feature, ctx, meta = {}) {
  if (!plannerEnabled() || !feature) return feature;

  const { header, cenarios } = parseFeatureEmCenarios(feature);
  if (!cenarios.length) return feature;

  const { cenarios: semDup, removidos } = removerCenariosRedundantes(cenarios, ctx);
  const lacunasRaw = gerarCenariosLacunas(ctx, semDup, meta)
    .filter(Boolean)
    .map((linhas) => ({
      titulo: (linhas[0] || '').replace(/^Cenário:\s*/i, '').trim(),
      linhas,
      texto: linhas.join('\n'),
    }));
  const { cenarios: lacunas, removidos: remLac } = removerCenariosRedundantes(
    lacunasRaw,
    ctx
  );
  removidos.push(...remLac);

  let todos = ordenarCenarios([...semDup, ...lacunas], ctx);
  const { cenarios: finais, removidos: remFinal } = removerCenariosRedundantes(todos, ctx);
  removidos.push(...remFinal);
  todos = finais;
  const cap = maxTotalCenarios(ctx, meta);
  if (Number.isFinite(cap) && todos.length > cap) {
    const removidosCap = todos.slice(cap).map((c) => c.titulo);
    todos = todos.slice(0, cap);
    removidos.push(...removidosCap);
  }

  const funcIdx = header.findIndex((l) => /^funcionalidade\s*:/i.test(l.trim()));
  const headerLimpo = header.filter(
    (l, i) => i === funcIdx || (!/^#\s*cenários/i.test(l.trim()) && !/^#\s+redundantes/i.test(l.trim()))
  );

  const qtdDev = meta.qtdDev ?? semDup.filter((c) => !/cobertura|lacuna/i.test(c.titulo)).length;
  const qtdExtra = todos.filter((c) => /cobertura\s*—/i.test(c.titulo)).length;
  const qtdLacunas = todos.filter((c) => /lacuna\s*—/i.test(c.titulo)).length;
  const planHeader = montarCabecalhoPlano(
    ctx,
    qtdDev,
    qtdExtra,
    qtdLacunas,
    removidos,
    todos
  );

  const out = [...planHeader, ''];
  if (funcIdx >= 0 && headerLimpo[funcIdx]) {
    out.push(headerLimpo[funcIdx], '');
  } else {
    const func = header.find((l) => /^funcionalidade\s*:/i.test(l.trim()));
    if (func) out.push(func, '');
  }

  for (const cen of todos) {
    out.push(...cen.linhas, '');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = {
  plannerEnabled,
  parseFeatureEmCenarios,
  planificarFeatureBdd,
  removerCenariosRedundantes,
  gerarCenariosLacunas,
  ordenarCenarios,
  classificarCenario,
  similaridade,
  maxTotalCenarios,
  contarBlocosDev,
};
