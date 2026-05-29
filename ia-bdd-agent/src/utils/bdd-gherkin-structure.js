/**
 * Validação e reparo de Gherkin desconexo (ex.: "E cenário:", Então incompleto, E após Então).
 */

const { limparTexto, entaoVerificavel } = require('./bdd-gherkin');
const { entaoEhVago, passoEhVago } = require('./bdd-rigor');
const { extrairValidacoesExatas } = require('./bdd-validacoes');

function entaoEhIncompleto(corpo) {
  const t = limparTexto(String(corpo || '').replace(/^ent[aã]o\s+/i, ''));
  if (!t || t.length < 12) return true;
  if (/^a\s+mensagem$/i.test(t)) return true;
  if (/^o\s+(sistema|comportamento|resultado)$/i.test(t)) return true;
  if (/^a\s+(tela|mensagem)\s*$/i.test(t)) return true;
  return entaoEhVago(t);
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
  if (!/^\s*Cen[aá]rio\s*:/im.test(t)) motivos.push('sem linha "Cenário:" válida');

  const blocos = extrairBlocosCenario(t);
  if (!blocos.length) motivos.push('nenhum cenário parseado');

  for (const b of blocos) {
    if (!b.dado.length) motivos.push(`"${b.titulo.slice(0, 40)}": sem Dado`);
    if (!b.quando.length) motivos.push(`"${b.titulo.slice(0, 40)}": sem Quando`);
    if (!b.entao.length) motivos.push(`"${b.titulo.slice(0, 40)}": sem Então`);
    for (const e of b.entao) {
      const corpo = e.replace(/^\s*ent[aã]o\s+/i, '');
      if (entaoEhIncompleto(corpo)) {
        motivos.push(`"${b.titulo.slice(0, 40)}": Então incompleto ou vago`);
      }
    }
    if (b.eAposEntao.length) {
      motivos.push(`"${b.titulo.slice(0, 40)}": linhas E após Então (estrutura inválida)`);
    }
  }

  return { ok: motivos.length === 0, motivos };
}

function extrairBlocosCenario(feature) {
  const linhas = String(feature || '').split(/\r?\n/);
  const blocos = [];
  let atual = null;
  let fase = 'pre'; // pre | dado | acao | pos

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

    if (/^cen[aá]rio\s*:/i.test(t)) {
      flush();
      atual = {
        titulo: t.replace(/^cen[aá]rio\s*:\s*/i, '').trim(),
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

/** @param {string} hint texto parcial (ex.: "a mensagem", título do cenário) */
function escolherEntaoDoContexto(ctx, usados, hint = '') {
  const pool = extrairValidacoesExatas(ctx);
  const h = `${hint}`.toLowerCase();

  const score = (entao) => {
    const e = entao.toLowerCase();
    let s = 0;
    if (/mensagem|autentic|login|sess[aã]o|credencial/.test(h) && /autentic|login|sess[aã]o|credencial|mensagem/.test(e)) s += 3;
    if (/laudo/.test(h) && /laudo/.test(e)) s += 3;
    if (/worklist|exame|fila|vis[ií]vel|permanece/.test(h) && /worklist|exame|fila|vis[ií]vel|permanece/.test(e)) s += 3;
    if (/salv|persist|grav/.test(h) && /salv|persist|grav|n[aã]o/.test(e)) s += 2;
    if (/solicit|nova/.test(h) && /solicit|nova|n[aã]o/.test(e)) s += 2;
    return s;
  };

  let best = null;
  let bestScore = 0;
  for (const v of pool) {
    if (usados.has(v.entao)) continue;
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
    if (!usados.has(v.entao)) {
      usados.add(v.entao);
      return v.entao;
    }
  }
  return null;
}

function completarEntaoIncompleto(corpo, ctx, usados, hint = '') {
  const t = limparTexto(String(corpo || '').replace(/^ent[aã]o\s+/i, ''));
  if (!entaoEhIncompleto(t)) {
    const ev = entaoVerificavel(t);
    return ev && !entaoEhVago(ev) ? ev : null;
  }
  const fromCtx = escolherEntaoDoContexto(ctx, usados, hint || t);
  if (fromCtx) return fromCtx;
  const { entaoSubstituto } = require('./bdd-rigor');
  const fb = entaoSubstituto(ctx);
  if (fb) return fb.replace(/^\s*ent[aã]o\s+/i, '').trim();
  return null;
}

/**
 * Repara Gherkin desconexo usando fatos do chamado quando possível.
 * @param {string} feature
 * @param {object} [ctx]
 */
function repararFeatureGherkinDesconexo(feature, ctx = {}) {
  if (!feature || typeof feature !== 'string') return feature;

  let text = feature.replace(/^\s*E\s+cen[aá]rio\s*:/gim, 'Cenário:');

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

  const { quandoSubstituto } = require('./bdd-rigor');
  const quandoFb = quandoSubstituto(ctx);

  const out = [...header];
  if (header.length) out.push('');

  for (const b of blocos) {
    out.push(`Cenário: ${b.titulo}`);
    const usados = new Set();

    for (const ln of b.dado) {
      out.push(ln.startsWith('  ') ? ln : `  ${ln.trim()}`);
    }
    if (!b.dado.length && ctx.ambiente) {
      const { dadoAcessaAmbiente } = require('./bdd-ambiente');
      out.push(dadoAcessaAmbiente(ctx.ambiente));
    }

    for (const ln of b.quando) {
      const norm = ln.trim();
      if (passoEhVago(norm) && quandoFb) out.push(quandoFb);
      else out.push(norm.startsWith('  ') ? norm : `  ${norm}`);
    }
    if (!b.quando.length && quandoFb) out.push(quandoFb);

    const candidatos = [];
    for (const ln of b.entao) {
      candidatos.push({ texto: ln, hint: `${b.titulo} ${ln}` });
    }
    for (const e of b.eAposEntao) {
      const corpo = e.replace(/^\s*e\s+/i, '').trim();
      if (corpo) candidatos.push({ texto: corpo, hint: corpo });
    }

    if (!candidatos.length) {
      const fb = completarEntaoIncompleto('', ctx, usados, b.titulo);
      if (fb) out.push(`  Então ${fb}`);
    } else {
      for (const c of candidatos) {
        const corpo = c.texto.replace(/^\s*ent[aã]o\s+/i, '').trim();
        const ev = completarEntaoIncompleto(corpo, ctx, usados, c.hint || b.titulo);
        if (ev && !entaoEhVago(ev)) out.push(`  Então ${ev}`);
      }
    }
    out.push('');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = {
  entaoEhIncompleto,
  validarEstruturaFeatureGherkin,
  extrairBlocosCenario,
  repararFeatureGherkinDesconexo,
};
