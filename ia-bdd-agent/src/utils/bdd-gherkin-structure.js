/**
 * Validação e reparo de Gherkin desconexo (ex.: "E cenário:", Então incompleto, E após Então).
 */

const {
  limparTexto,
  entaoVerificavel,
  passosParaStepsGherkin,
  fraseEhIncompleta,
  passoEhColagemGherkin,
  objetivarFrase,
  passoGherkin,
} = require('./bdd-gherkin');
const { entaoEhVago, passoEhVago } = require('./bdd-rigor');
const {
  extrairValidacoesExatas,
  splitCriteriosResultado,
  splitAssercoesColadas,
} = require('./bdd-validacoes');
const { isLinhaCenario, stripPrefixoNumericoCenario } = require('./bdd-scenario-numbering');

function entaoEhIncompleto(corpo) {
  const t = limparTexto(String(corpo || '').replace(/^ent[aã]o\s+/i, ''));
  if (!t || t.length < 12) return true;
  if (fraseEhIncompleta(t)) return true;
  if (/^a\s+mensagem$/i.test(t)) return true;
  if (/^o\s+(sistema|comportamento|resultado)$/i.test(t)) return true;
  if (/^a\s+(tela|mensagem)\s*$/i.test(t)) return true;
  return entaoEhVago(t);
}

function passosCompletosDoContexto(ctx) {
  if (limparTexto(ctx?.cenariosTesteDev)) return [];
  const fonte =
    ctx.passosObjetivos?.join('\n') ||
    ctx.passosFiltrados ||
    ctx.passos ||
    ctx.descricaoFiltrada ||
    ctx.descricao ||
    '';
  return passosParaStepsGherkin(fonte).filter((ln) => {
    const corpo = ln.replace(/^\s*(quando|e)\s+/i, '').trim();
    return corpo && !passoEhColagemGherkin(corpo) && !passoEhVago(ln);
  });
}

function entaoCompletoDoContexto(ctx, hint = '') {
  const usados = new Set();
  const fromPool = escolherEntaoDoContexto(ctx, usados, hint);
  if (fromPool && !entaoEhIncompleto(fromPool)) return fromPool;

  if (ctx.resultadoEsperado) {
    for (const p of splitCriteriosResultado(ctx.resultadoEsperado)) {
      const ev = entaoVerificavel(p);
      if (ev && !entaoEhIncompleto(ev) && !entaoEhVago(ev)) return ev;
    }
  }
  if (ctx.resultadoObtido) {
    const ev = entaoVerificavel(ctx.resultadoObtido);
    if (ev && !entaoEhIncompleto(ev) && !entaoEhVago(ev)) return ev;
  }
  if (ctx.defeitoNasEvidencias) {
    const ev = entaoVerificavel(ctx.defeitoNasEvidencias);
    if (ev && !entaoEhIncompleto(ev)) return ev;
  }
  return null;
}

function normalizarOrdemPassosNoBloco(b) {
  const dado = [...b.dado];
  const acao = [];
  const entao = [...b.entao];
  let viuQuando = false;

  for (const ln of b.quando) {
    const t = ln.trim();
    if (/^\s*quando\s+/i.test(t)) {
      acao.push(t.startsWith('  ') ? t : `  ${t}`);
      viuQuando = true;
      continue;
    }
    if (/^\s*e\s+/i.test(t)) {
      if (!viuQuando) {
        const corpo = t.replace(/^\s*e\s+/i, '').trim();
        const q = objetivarFrase(corpo);
        if (q) acao.push(`  Quando ${q}`);
        viuQuando = true;
      } else {
        acao.push(t.startsWith('    ') ? t : `    ${t.trim()}`);
      }
    }
  }

  return { ...b, dado, quando: acao, entao, eAposEntao: [...(b.eAposEntao || [])] };
}

function linhasCorpoBlocoCenario(b) {
  const norm = normalizarOrdemPassosNoBloco(b);
  return [...norm.dado, ...norm.quando, ...norm.entao, ...(norm.eAposEntao || [])];
}

function blocoCenarioValido(b) {
  const norm = normalizarOrdemPassosNoBloco(b);
  if (!norm.dado.length || !norm.quando.length || !norm.entao.length) return false;
  const entaoTextos = norm.entao.map((e) => e.replace(/^\s*ent[aã]o\s+/i, '').trim().toLowerCase());
  if (new Set(entaoTextos).size !== entaoTextos.length) return false;
  for (const q of norm.quando) {
    const corpo = q.replace(/^\s*(quando|e)\s+/i, '').trim();
    if (passoEhVago(q)) return false;
    if (passoEhColagemGherkin(corpo) && fraseEhIncompleta(corpo)) return false;
  }
  for (const e of norm.entao) {
    if (entaoEhIncompleto(e.replace(/^\s*ent[aã]o\s+/i, ''))) return false;
  }
  for (const e of norm.eAposEntao || []) {
    const corpo = e.replace(/^\s*e\s+/i, '').trim();
    if (!corpo || fraseEhIncompleta(corpo)) return false;
  }
  return true;
}

/**
 * @param {string} feature
 * @returns {{ ok: boolean, motivos: string[] }}
 */
function validarEstruturaFeatureGherkin(feature) {
  const motivos = [];
  const t = String(feature || '').trim();
  if (!t || t.length < 40) {
    motivos.push('feature vazia ou curta');
    return { ok: false, motivos };
  }
  if (!/funcionalidade\s*:/i.test(t)) motivos.push('sem Funcionalidade');
  if (/^\s*E\s+cen[aá]rio\s*:/im.test(t)) motivos.push('usa "E cenário" em vez de "Cenário"');
  const temLinhaCenario = t
    .split(/\r?\n/)
    .some((l) => isLinhaCenario(l.trim()));
  if (!temLinhaCenario) motivos.push('sem linha "Cenário:" válida');

  const blocos = extrairBlocosCenario(t);
  if (!blocos.length) motivos.push('nenhum cenário parseado');

  for (const b of blocos) {
    if (!b.dado.length) motivos.push(`"${b.titulo.slice(0, 40)}": sem Dado`);
    if (!b.quando.length) motivos.push(`"${b.titulo.slice(0, 40)}": sem Quando`);
    if (!b.entao.length) motivos.push(`"${b.titulo.slice(0, 40)}": sem Então`);
    for (const q of b.quando) {
      const corpo = q.replace(/^\s*(quando|e)\s+/i, '').trim();
      if (passoEhColagemGherkin(corpo)) {
        motivos.push(`"${b.titulo.slice(0, 40)}": Quando incompleto ou colado`);
      }
    }
    for (const e of b.entao) {
      const corpo = e.replace(/^\s*ent[aã]o\s+/i, '');
      if (entaoEhIncompleto(corpo)) {
        motivos.push(`"${b.titulo.slice(0, 40)}": Então incompleto ou vago`);
      }
    }
    if (b.eAposEntao.length) {
      for (const e of b.eAposEntao) {
        const corpo = e.replace(/^\s*e\s+/i, '').trim();
        if (!corpo || fraseEhIncompleta(corpo)) {
          motivos.push(`"${b.titulo.slice(0, 40)}": E após Então incompleto ou vago`);
        }
      }
    }
  }

  return { ok: motivos.length === 0, motivos };
}

function extrairBlocosCenario(feature) {
  const linhas = String(feature || '').split(/\r?\n/);
  const blocos = [];
  let atual = null;
  let fase = 'pre';

  const flush = () => {
    if (atual) blocos.push(atual);
    atual = null;
    fase = 'pre';
  };

  for (const line of linhas) {
    const trimmed = line.trimEnd();
    const t = trimmed.trim();
    if (!t) continue;
    if (/^funcionalidade\s*:/i.test(t) || /^#\s/.test(t)) continue;

    if (isLinhaCenario(t)) {
      flush();
      atual = {
        titulo: stripPrefixoNumericoCenario(t.replace(/^cen[aá]rio\s*(?:\d+\s*)?:\s*/i, '')),
        dado: [],
        quando: [],
        entao: [],
        eAposEntao: [],
      };
      fase = 'pre';
      continue;
    }

    if (!atual) continue;

    if (/^\s*dado\s+que\s+/i.test(t)) {
      fase = 'dado';
      atual.dado.push(t);
      continue;
    }
    if (/^\s*quando\s+/i.test(t)) {
      fase = 'acao';
      atual.quando.push(t);
      continue;
    }
    if (/^\s*ent[aã]o\s+/i.test(t)) {
      fase = 'pos';
      atual.entao.push(t);
      continue;
    }
    if (/^\s*mas\s+/i.test(t)) {
      fase = 'pos';
      atual.entao.push(t);
      continue;
    }
    if (/^\s*e\s+/i.test(t)) {
      if (fase === 'pos') atual.eAposEntao.push(t);
      else if (fase === 'acao' || fase === 'dado') {
        if (fase === 'dado') atual.dado.push(t);
        else atual.quando.push(t);
      } else atual.dado.push(t);
    }
  }
  flush();
  return blocos;
}

function escolherEntaoDoContexto(ctx, usados, hint = '') {
  const pool = extrairValidacoesExatas(ctx);
  const h = `${hint}`.toLowerCase();

  const score = (entao) => {
    const e = entao.toLowerCase();
    let s = 0;
    if (/mensagem|autentic|login|sess[aã]o|credencial/.test(h) && /autentic|login|sess[aã]o|credencial|mensagem/.test(e)) s += 3;
    if (/laudo|rodap[eé]/.test(h) && /laudo|rodap[eé]|impress/.test(e)) s += 3;
    if (/worklist|exame|fila|vis[ií]vel|permanece/.test(h) && /worklist|exame|fila|vis[ií]vel|permanece/.test(e)) s += 3;
    if (/salv|persist|grav|configur/.test(h) && /salv|persist|grav|configur|n[aã]o/.test(e)) s += 2;
    if (/solicit|nova/.test(h) && /solicit|nova|n[aã]o/.test(e)) s += 2;
    return s;
  };

  let best = null;
  let bestScore = 0;
  for (const v of pool) {
    if (usados.has(v.entao)) continue;
    if (entaoEhIncompleto(v.entao)) continue;
    const s = score(v.entao);
    if (s > bestScore) {
      bestScore = s;
      best = v.entao;
    }
  }
  if (best) {
    usados.add(best);
    return best;
  }
  for (const v of pool) {
    if (!usados.has(v.entao) && !entaoEhIncompleto(v.entao)) {
      usados.add(v.entao);
      return v.entao;
    }
  }
  return null;
}

function buscarEntaoCompletoNoDev(ctx, fragmento) {
  const dev = limparTexto(ctx?.cenariosTesteDev || '');
  const frag = limparTexto(String(fragmento || ''));
  if (!dev || !frag || frag.length < 14) return null;
  const needle = frag.slice(0, Math.min(48, frag.length)).toLowerCase();
  const { entaoVerificavelDev } = require('./bdd-gherkin');
  const { splitResultadoDevEmAssercoes, formatarEntaoDevResultado } = require('./bdd-validacoes');

  for (const parte of dev.split(/\s+-\s+(?=(?:Dado|Given)\b)/i)) {
    const m = parte.match(/dever[aá]\s+(.+)$/is);
    if (m) {
      const ev = formatarEntaoDevResultado(m[1]) || entaoVerificavelDev(m[1]);
      if (ev && ev.toLowerCase().includes(needle.slice(0, 24))) return ev;
    }
    const mRes = parte.match(/resultado\s+esperado\s*:\s*(.+)$/is);
    if (mRes) {
      for (const p of splitResultadoDevEmAssercoes(mRes[1])) {
        const ev = formatarEntaoDevResultado(p);
        if (ev && ev.toLowerCase().includes(needle.slice(0, 24))) return ev;
      }
    }
  }
  const idx = dev.toLowerCase().indexOf(needle.slice(0, 32));
  if (idx >= 0) {
    const trecho = dev.slice(idx, idx + 420);
    const ev = entaoVerificavelDev(trecho);
    if (ev && !fraseEhIncompleta(ev)) return ev;
  }
  return null;
}

function completarEntaoIncompleto(corpo, ctx, usados, hint = '') {
  const t = limparTexto(String(corpo || '').replace(/^ent[aã]o\s+/i, ''));
  if (!entaoEhIncompleto(t)) {
    const ev = entaoVerificavel(t);
    return ev && !entaoEhVago(ev) && !fraseEhIncompleta(ev) ? ev : null;
  }
  const fromDev = buscarEntaoCompletoNoDev(ctx, t);
  if (fromDev && !entaoEhVago(fromDev) && !usados.has(fromDev)) {
    usados.add(fromDev);
    return fromDev;
  }
  const fromCtx = escolherEntaoDoContexto(ctx, usados, hint || t);
  if (fromCtx) return fromCtx;
  const completo = entaoCompletoDoContexto(ctx, hint || t);
  if (completo) return completo;
  const { entaoSubstituto } = require('./bdd-rigor');
  const fb = entaoSubstituto(ctx);
  if (fb) {
    const ev = fb.replace(/^\s*ent[aã]o\s+/i, '').trim();
    if (!entaoEhIncompleto(ev)) return ev;
  }
  return null;
}

function montarBlocoCenarioCompleto(b, ctx) {
  const usados = new Set();
  const out = [`Cenário: ${b.titulo}`];

  let temDado = false;
  for (const ln of b.dado) {
    if (/acessa\s+o\s+ambiente/i.test(ln)) temDado = true;
    out.push(ln.startsWith('  ') ? ln : `  ${ln.trim()}`);
  }
  if (!temDado && ctx.ambiente) {
    const { dadoAcessaAmbiente } = require('./bdd-ambiente');
    out.push(dadoAcessaAmbiente(ctx.ambiente));
  }

  const quandoRuim = b.quando.some((ln) => {
    const corpo = ln.replace(/^\s*(quando|e)\s+/i, '').trim();
    if (passoEhVago(ln)) return true;
    if (!passoEhColagemGherkin(corpo)) return false;
    return fraseEhIncompleta(corpo);
  });

  if (quandoRuim || !b.quando.length) {
    const passos = passosCompletosDoContexto(ctx);
    if (passos.length) {
      for (const ln of passos) {
        out.push(ln.startsWith('  ') ? ln : `  ${ln.trim()}`);
      }
    } else {
      const { quandoSubstituto } = require('./bdd-rigor');
      const fb = quandoSubstituto(ctx);
      if (fb) out.push(fb.startsWith('  ') ? fb : `  ${fb.trim()}`);
      else {
        for (const ln of b.quando) {
          if (!passoEhVago(ln)) out.push(ln.startsWith('  ') ? ln : `  ${ln.trim()}`);
        }
      }
    }
  } else {
    for (const ln of b.quando) {
      const norm = ln.trim();
      if (passoEhVago(norm)) continue;
      out.push(norm.startsWith('  ') ? norm : `  ${norm}`);
    }
  }

  const entaoLinhas = [];
  for (const ln of b.entao) {
    const corpo = ln.replace(/^\s*ent[aã]o\s+/i, '').trim();
    const ev = completarEntaoIncompleto(corpo, ctx, usados, `${b.titulo} ${corpo}`);
    if (ev && !entaoEhVago(ev)) entaoLinhas.push(`  Então ${ev}`);
  }
  for (const e of b.eAposEntao) {
    const corpo = e.replace(/^\s*e\s+/i, '').trim();
    const ev = completarEntaoIncompleto(corpo, ctx, usados, corpo);
    if (ev && !entaoEhVago(ev)) entaoLinhas.push(`  Então ${ev}`);
  }
  if (!entaoLinhas.length) {
    const fb = entaoCompletoDoContexto(ctx, b.titulo);
    if (fb) entaoLinhas.push(`  Então ${fb}`);
  }
  const entaoUnicos = [...new Set(entaoLinhas)];
  if (!entaoUnicos.length) return null;

  out.push(...entaoUnicos);
  return out;
}

/**
 * Repara Gherkin desconexo usando fatos do chamado quando possível.
 * @param {string} feature
 * @param {object} [ctx]
 */
function repararFeatureGherkinDesconexo(feature, ctx = {}) {
  if (!feature || typeof feature !== 'string') return feature;

  const text = feature.replace(/^\s*E\s+cen[aá]rio\s*:/gim, 'Cenário:');

  const header = [];
  const body = [];
  let inBody = false;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!inBody && (/^#\s/.test(t) || /^funcionalidade\s*:/i.test(t))) {
      header.push(line);
      if (/^funcionalidade\s*:/i.test(t)) inBody = true;
      continue;
    }
    inBody = true;
    body.push(line);
  }

  const blocos = extrairBlocosCenario(body.join('\n'));
  if (!blocos.length) return text;

  const out = [...header];
  if (header.length) out.push('');

  for (const b of blocos) {
    const norm = normalizarOrdemPassosNoBloco(b);
    if (blocoCenarioValido(norm)) {
      out.push(`Cenário: ${norm.titulo}`);
      for (const ln of linhasCorpoBlocoCenario(norm)) {
        out.push(ln.startsWith('  ') ? ln : `  ${ln.trim()}`);
      }
      out.push('');
      continue;
    }
    if (norm.dado.length && norm.quando.length && norm.entao.length && ctx.cenariosTesteDev) {
      const bruto = [
        `Cenário: ${norm.titulo}`,
        ...linhasCorpoBlocoCenario(norm),
      ].join('\n');
      const expandido = repararAssercoesColadasNaFeature(bruto);
      const reb = extrairBlocosCenario(expandido)[0];
      if (reb && reb.dado.length && reb.quando.length && reb.entao.length) {
        out.push(`Cenário: ${reb.titulo}`);
        for (const ln of linhasCorpoBlocoCenario(reb)) {
          out.push(ln.startsWith('  ') ? ln : `  ${ln.trim()}`);
        }
        out.push('');
        continue;
      }
    }
    const montado = montarBlocoCenarioCompleto(norm, ctx);
    if (!montado) continue;
    out.push(...montado);
    out.push('');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * Remove cenários que permanecem incompletos; garante início (Dado) e fim (Então) em cada um.
 * @param {string} feature
 * @param {object} [ctx]
 */
function assegurarCenariosCompletos(feature, ctx = {}) {
  if (!feature || typeof feature !== 'string') return feature;

  const reparado = repararFeatureGherkinDesconexo(feature, ctx);

  const header = [];
  const body = [];
  let inBody = false;
  for (const line of reparado.split(/\r?\n/)) {
    const t = line.trim();
    if (!inBody && (/^#\s/.test(t) || /^funcionalidade\s*:/i.test(t))) {
      header.push(line);
      if (/^funcionalidade\s*:/i.test(t)) inBody = true;
      continue;
    }
    inBody = true;
    body.push(line);
  }

  const blocos = extrairBlocosCenario(body.join('\n'));
  const out = [...header];
  if (header.length) out.push('');

  for (const b of blocos) {
    const norm = normalizarOrdemPassosNoBloco(b);
    if (blocoCenarioValido(norm)) {
      out.push(`Cenário: ${norm.titulo}`);
      for (const ln of linhasCorpoBlocoCenario(norm)) {
        out.push(ln.startsWith('  ') ? ln : `  ${ln.trim()}`);
      }
      out.push('');
      continue;
    }
    const montado = montarBlocoCenarioCompleto(norm, ctx);
    if (!montado) continue;
    const reb = extrairBlocosCenario(montado.join('\n'))[0];
    if (reb && blocoCenarioValido(reb)) {
      out.push(...montado);
      out.push('');
    }
  }

  const texto = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  return texto ? `${texto}\n` : reparado;
}

/** Expande asserções coladas com " - " em linhas Então/E separadas. */
function expandirLinhaComTracos(linha) {
  const t = String(linha || '');
  const m = t.match(/^(\s*)((?:Então|Entao|Mas|E|Quando))\s+(.+)$/i);
  if (!m) return [linha];
  const [, indent, kw, corpo] = m;
  const tipo = kw.toLowerCase();

  let partes = [];
  if (tipo.startsWith('ent')) {
    const { splitResultadoDevEmAssercoes } = require('./bdd-validacoes');
    partes = splitResultadoDevEmAssercoes(corpo.replace(/\s*---+\s*$/g, ''));
  } else if (tipo === 'quando') {
    const { splitPassosColados } = require('./bdd-gherkin');
    partes = splitPassosColados(corpo);
  } else {
    partes = splitAssercoesColadas(corpo);
  }
  if (partes.length <= 1) return [linha];

  const pad = indent || '  ';

  if (tipo.startsWith('ent')) {
    const { formatarEntaoDevResultado } = require('./bdd-validacoes');
    const { maxEntaoPorCenarioDev } = require('./bdd-gherkin');
    const expandidas = partes
      .map((p) => {
        const ev = formatarEntaoDevResultado(p) || entaoVerificavel(p);
        return ev && !entaoEhIncompleto(ev) ? `${pad}Então ${ev}` : null;
      })
      .filter(Boolean);
    const maxEntao = maxEntaoPorCenarioDev();
    if (expandidas.length) return expandidas.slice(0, maxEntao);
    const evInteiro = formatarEntaoDevResultado(corpo) || entaoVerificavel(corpo);
    if (evInteiro && !entaoEhIncompleto(evInteiro)) {
      return [`${pad}Então ${evInteiro}`];
    }
    return [linha];
  }
  if (tipo === 'e') {
    const expandidas = partes
      .map((p) => {
        const obj = objetivarFrase(p, 120);
        if (!obj) return null;
        const eText =
          /^(o|a|os|as|sou|estou|existem|gerencio|há)\s/i.test(obj) || /^o\s+usu[aá]rio\s+/i.test(obj)
            ? obj
            : `o usuário ${obj}`;
        return `    E ${eText}`;
      })
      .filter(Boolean);
    return expandidas.length ? expandidas : [linha];
  }
  if (tipo === 'quando' && partes.length >= 2) {
    const { quandoAPartirDeDescricaoDev } = require('./bdd-gherkin');
    const linhas = [];
    const q0 = quandoAPartirDeDescricaoDev(partes[0]) || passoGherkin('Quando', partes[0]);
    if (q0) linhas.push(q0);
    for (const p of partes.slice(1, 3)) {
      const e = passoGherkin('E', p);
      if (e) linhas.push(e);
    }
    return linhas.length ? linhas : [linha];
  }
  return [linha];
}

/** Une Quando de API partido em "sem informar" + E "o token…". */
function repararQuandoPartido(linhas) {
  const out = [];
  for (let i = 0; i < (linhas || []).length; i++) {
    const ln = String(linhas[i] || '');
    const next = String(linhas[i + 1] || '');
    if (
      /^\s*Quando\s+a requisi.+sem informar\s*$/i.test(ln.trim()) &&
      /^\s*E\s+o token\b/i.test(next.trim())
    ) {
      const sufixo = next.trim().replace(/^\s*E\s+/i, '');
      out.push(ln.replace(/sem informar\s*$/i, `sem informar ${sufixo}`));
      i += 1;
      continue;
    }
    out.push(ln);
  }
  return out;
}

function corrigirQuandoUsuarioArtigo(feature) {
  const unido = repararQuandoPartido(String(feature || '').split(/\r?\n/)).join('\n');
  return unido
    .replace(
      /^(\s*Quando\s+)o usuário\s+(a|o|os|as)\s+/gim,
      '$1$2 '
    )
    .replace(
      /^(\s*Quando\s+)o usuário\s+usu[aá]rio[\s,]+/gim,
      '$1usuário '
    )
    .replace(
      /^(\s*Quando\s+)o usuário\s+(usu[aá]rios?)\b/gim,
      '$1$2'
    );
}

function linhaTemAssercoesColadas(trimmed) {
  if (!/^\s*(então|entao|e|quando)\s+/i.test(trimmed)) return false;
  if (/^\s*quando\s+a requisi/i.test(trimmed)) return false;
  if (/\s+-\s+/.test(trimmed)) return true;
  const corpo = trimmed.replace(/^\s*(então|entao|e|quando)\s+/i, '');
  const { splitResultadoDevEmAssercoes, splitAssercoesColadas } = require('./bdd-validacoes');
  if (/^\s*ent/i.test(trimmed)) {
    return splitResultadoDevEmAssercoes(corpo).length > 1;
  }
  if (/^\s*quando/i.test(trimmed)) {
    const { splitPassosColados } = require('./bdd-gherkin');
    return splitPassosColados(corpo).length > 1;
  }
  return splitAssercoesColadas(corpo).length > 1;
}

function repararAssercoesColadasNaFeature(feature) {
  if (!feature) return feature;
  const out = [];
  for (const line of String(feature).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (linhaTemAssercoesColadas(trimmed)) {
      out.push(...expandirLinhaComTracos(line));
    } else {
      out.push(line);
    }
  }
  const { aplicarLimiteEPorCenarioNaFeature } = require('./bdd-gherkin');
  return corrigirQuandoUsuarioArtigo(aplicarLimiteEPorCenarioNaFeature(out.join('\n')));
}

module.exports = {
  entaoEhIncompleto,
  fraseEhIncompleta,
  passoEhColagemGherkin,
  validarEstruturaFeatureGherkin,
  extrairBlocosCenario,
  repararFeatureGherkinDesconexo,
  assegurarCenariosCompletos,
  repararAssercoesColadasNaFeature,
  corrigirQuandoUsuarioArtigo,
  entaoCompletoDoContexto,
  passosCompletosDoContexto,
  blocoCenarioValido,
  linhasCorpoBlocoCenario,
};
