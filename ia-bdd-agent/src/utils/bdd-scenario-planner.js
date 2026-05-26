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
  const matches = dev.match(/^\s*(?:cenário|cenario)\s*:/gim);
  return matches ? matches.length : 1;
}

/**
 * Teto de cenários por feature. Com 2+ blocos Dev, sobe para 5 (4 se retorno QA).
 * Override: BDD_MAX_SCENARIOS.
 */
function maxTotalCenarios(ctx, meta = {}) {
  const fromEnv = Number.parseInt(process.env.BDD_MAX_SCENARIOS || '', 10);
  if (Number.isFinite(fromEnv) && fromEnv >= 2) return Math.min(fromEnv, 8);

  const qtdDev = contarBlocosDev(ctx, meta);
  if (qtdDev >= 2) {
    return ctx.qaHistorico?.isRetornoQa ? 4 : 5;
  }
  if (ctx.qaHistorico?.isRetornoQa) return 3;
  return 4;
}

function removerCenariosRedundantes(cenarios, ctx) {
  const limiar =
    Number.parseFloat(process.env.BDD_DEDUP_SIMILARITY || '0.68') || 0.68;
  const kept = [];
  const removidos = [];

  for (const cen of cenarios) {
    const entao = extrairEntao(cen);
    const assinatura = `${normalizarTexto(cen.titulo)}|${normalizarTexto(entao)}|${normalizarTexto(
      cen.linhas.filter((l) => /^\s*(quando|e)\s+/i.test(l)).join(' ')
    )}`;

    let duplicata = false;
    for (const prev of kept) {
      const simTitulo = similaridade(cen.titulo, prev.titulo);
      const simEntao = similaridade(extrairEntao(cen), extrairEntao(prev));
      const simAssin = similaridade(assinatura, `${normalizarTexto(prev.titulo)}|${normalizarTexto(extrairEntao(prev))}`);

      if (simTitulo >= limiar || (simEntao >= limiar && simTitulo >= 0.45) || simAssin >= limiar) {
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
function gerarCenariosLacunas(ctx, cenariosExistentes) {
  if (process.env.BDD_GAP_SCENARIOS === '0') return [];

  const blob = cenariosExistentes.map((c) => c.texto).join('\n').toLowerCase();
  const consolidado = textoConsolidado(ctx, []);
  const lacunas = [];
  const max = Number.parseInt(process.env.BDD_GAP_MAX || '1', 10) || 1;
  const temDefeito = devJaCobreTexto(blob, [/defeito|obtido|incorreto|mas\s+o\s+esperado/i]);

  const validacoes = extrairValidacoesExatas(ctx);
  for (const v of validacoes) {
    if (v.origem.includes('obtido') && temDefeito) continue;
    if (v.origem.includes('descri') && temDefeito) continue;
    if (v.origem.includes('esperado') && devJaCobreTexto(blob, [/valida[cç][aã]o\s+principal|então/i])) {
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
    lacunas.push(
      montarCenarioExtra(
        'Lacuna — reprodução do defeito reportado',
        ctx,
        ctx.passosFiltrados || ctx.passos || 'reproduzir o fluxo do chamado',
        `  Então ${String(ctx.resultadoObtido).slice(0, 110)}`
      )
    );
  }

  if (
    lacunas.length < max &&
    (consolidado.includes('worklist') && consolidado.includes('portal')) &&
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

function montarCabecalhoPlano(ctx, qtdDev, qtdExtra, qtdLacunas, removidos) {
  const linhas = [];
  const partes = [`${qtdDev} do Dev`];
  if (qtdExtra) partes.push(`${qtdExtra} cobertura`);
  if (qtdLacunas) partes.push(`${qtdLacunas} lacuna(s)`);
  linhas.push(`# Cenários QA: ${partes.join(' + ')} — ordem por risco/criticidade`);
  if (ctx.resumoObjetivo) {
    linhas.push(`# ${ctx.resumoObjetivo.slice(0, 200)}`);
  }
  if (removidos.length) {
    linhas.push(`# Redundantes removidos: ${removidos.slice(0, 4).join('; ')}`);
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
  const lacunas = gerarCenariosLacunas(ctx, semDup).map((linhas) => ({
    titulo: (linhas[0] || '').replace(/^Cenário:\s*/i, '').trim(),
    linhas,
    texto: linhas.join('\n'),
  }));

  let todos = ordenarCenarios([...semDup, ...lacunas], ctx);
  const cap = maxTotalCenarios(ctx, meta);
  if (todos.length > cap) {
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
  const planHeader = montarCabecalhoPlano(ctx, qtdDev, qtdExtra, qtdLacunas, removidos);

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
