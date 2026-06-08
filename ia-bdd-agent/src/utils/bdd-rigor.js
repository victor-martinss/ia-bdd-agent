const { detectAmbiente, dadoAcessaAmbiente } = require('./bdd-ambiente');
const {
  limparTexto,
  entaoVerificavel,
  passoEhColagemDescricao,
  passosParaStepsGherkin,
  passoGherkin,
  passosAPartirDoTitulo,
  fraseEhIncompleta,
} = require('./bdd-gherkin');

function rigorEnabled() {
  return process.env.BDD_RIGOR_MODE !== '0';
}

const VAGO_QUANDO =
  /executa\s+(os\s+)?passos\s+descritos|executa\s+o\s+fluxo|reproduz\s+o\s+fluxo|fluxo\s+principal\s+do\s+chamado|fluxo\s+descrito\s+no\s+chamado|inicia a ação principal|fluxo complementar|testa\s+o\s+comportamento|valida\s+o\s+comportamento|comportamento\s+do\s+chamado/i;

const VAGO_ENTAO =
  /comportamento\s+(deve\s+estar\s+)?alinhad|corresponde\s+ao\s+(esperado|critério)|crit[eé]rio\s+de\s+aceite|regra\s+de\s+neg[oó]cio|sem\s+regress[oõ]es|atender\s+ao\s+objetivo\s+da\s+melhoria|não apresenta erro indevido|perda inconsistente|comportamento esperado é observado/i;

const DADO_INVALIDO =
  /sistema\s+est[aá]\s+em\s+opera[çc][aã]o|cen[aá]rio\s+principal\s+foi\s+executado|fluxo\s+[eé]\s+conclu[ií]do|time\s+analisou|melhoria\s+for\s+implementada|cen[aá]rio\s+do\s+dev\s+prev[eê]|dado\s+que\s+eu\s+/i;

const E_INVALIDO =
  /^\d+\s*[-–—]\s*.+\d+\s*[-–—]|cen[aá]rio\s+de\s+teste\s+\d|devo\s+conseguir|prev[eê]\s*:/i;

function entaoEhVago(texto) {
  const t = limparTexto(String(texto || '').replace(/^ent[aã]o\s+/i, ''));
  if (!t || t.length < 6) return true;
  if (/^a\s+mensagem$/i.test(t)) return true;
  if (/^a\s+(tela|mensagem)\s*$/i.test(t)) return true;
  return VAGO_ENTAO.test(t);
}

function passoEhVago(texto) {
  const t = limparTexto(String(texto || '').replace(/^quando\s+|^e\s+o\s+usu[aá]rio\s+/i, ''));
  if (!t) return true;
  if (VAGO_QUANDO.test(t)) return true;
  if (passoEhColagemDescricao(t)) return true;
  if (t.split(/\s+/).length > 18) return true;
  return false;
}

function linhaDadoInvalida(linha) {
  const resto = String(linha || '')
    .replace(/^\s*dado\s+que\s+(o\s+usu[aá]rio\s+)?/i, '')
    .trim();
  return DADO_INVALIDO.test(resto) || DADO_INVALIDO.test(linha);
}

function linhaEInvalida(linha) {
  const resto = String(linha || '')
    .replace(/^\s*e\s+/i, '')
    .trim();
  if (E_INVALIDO.test(resto)) return true;
  if (passoEhColagemDescricao(resto)) return true;
  if (resto.length > 100) return true;
  return false;
}

function extrairEntaoDoTexto(texto) {
  const linhas = String(texto || '').split(/\r?\n/);
  for (const l of linhas) {
    const t = l.trim();
    if (/^ent[aã]o\s+/i.test(t)) {
      return t.replace(/^ent[aã]o\s+/i, '').trim();
    }
  }
  const inline = String(texto || '').match(/ent[aã]o\s+(.+?)(?:\n|$)/i);
  if (inline && inline[1]) return inline[1].trim();
  return '';
}

/**
 * Então por bloco Dev: só o que está no bloco; não puxa resultado global em multi-cenário.
 */
function entaoParaBlocoDev(ctx, corpoBloco) {
  const bruto = extrairEntaoDoTexto(corpoBloco);
  if (bruto) {
    const ev = entaoVerificavel(bruto);
    if (ev && !entaoEhVago(ev)) return `  Então ${ev}`;
  }
  const { extrairAssertaoDeBlocoDev } = require('./bdd-validacoes');
  const assertaoLista = extrairAssertaoDeBlocoDev(corpoBloco);
  if (assertaoLista) {
    const ev = entaoVerificavel(assertaoLista);
    if (ev && !entaoEhVago(ev)) return `  Então ${ev}`;
  }
  return null;
}

function quandoParaBlocoDev(bloco, ctx) {
  const q = quandoSubstituto(ctx);
  if (q && !passoEhVago(q)) return q;

  const blob = [bloco?.title, ctx?.titulo, ctx?.descricao]
    .map((s) => limparTexto(s))
    .filter(Boolean)
    .join(' ');
  if (/viewer|dicom/i.test(blob)) {
    return passoGherkin('Quando', 'o usuário acessa o Dicom Viewer Web');
  }

  const passos = passosAPartirDoTitulo(ctx?.titulo || bloco?.title || '');
  const qTitulo = passos.find((l) => /^\s*Quando/i.test(l));
  if (qTitulo && !passoEhVago(qTitulo)) return qTitulo;

  return passoGherkin('Quando', 'o usuário acessa a funcionalidade descrita no cenário Dev');
}

function quandoSubstituto(ctx) {
  const passos =
    ctx.passosObjetivos?.join('\n') ||
    ctx.passosFiltrados ||
    ctx.passos ||
    '';
  const steps = passosParaStepsGherkin(passos);
  const q = steps.find((l) => /^\s*quando\s+/i.test(l));
  if (q && !passoEhVago(q)) return q;
  const e = steps.find((l) => /^\s+e\s+/i.test(l));
  if (e && !passoEhVago(e)) return e.replace(/^\s*e\s+/i, '  Quando ');
  return null;
}

function entaoSubstituto(ctx) {
  if (ctx.resultadoEsperado) {
    const ev = entaoVerificavel(ctx.resultadoEsperado);
    if (ev && !entaoEhVago(ev)) return `  Então ${ev}`;
  }
  if (ctx.resultadoObtido) {
    const ev = entaoVerificavel(ctx.resultadoObtido);
    if (ev && !entaoEhVago(ev)) return `  Então ${ev}`;
  }
  return null;
}

/**
 * Pós-processa feature: remove colagens, troca Dado/Quando/Então vagos.
 */
function rigorizarFeatureBdd(feature, ctx = {}) {
  if (!rigorEnabled() || !feature) return feature;

  const amb =
    ctx.ambiente || detectAmbiente(ctx.titulo, ctx.cenariosTesteDev);
  const dadoOk = dadoAcessaAmbiente(amb);
  const quandoFallback = quandoSubstituto(ctx);
  const entaoFallback = entaoSubstituto(ctx);

  const out = [];
  let temQuandoNoCenario = false;
  let temEntaoNoCenario = false;
  let dentroCenario = false;

  const flushCenarioDefaults = () => {
    if (!dentroCenario) return;
    if (!temQuandoNoCenario && quandoFallback) out.push(quandoFallback);
    if (!temEntaoNoCenario && entaoFallback) out.push(entaoFallback);
    temQuandoNoCenario = false;
    temEntaoNoCenario = false;
    dentroCenario = false;
  };

  for (const line of feature.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    const t = trimmed.trim();

    if (/^cenário\s*:/i.test(t)) {
      flushCenarioDefaults();
      dentroCenario = true;
      out.push(trimmed);
      continue;
    }

    if (/^funcionalidade\s*:/i.test(t) || /^#\s/.test(t)) {
      flushCenarioDefaults();
      out.push(trimmed);
      continue;
    }

    if (!dentroCenario) {
      if (trimmed) out.push(trimmed);
      continue;
    }

    if (!t) {
      out.push('');
      continue;
    }

    if (/^\s*dado\s+que\s+/i.test(t)) {
      if (linhaDadoInvalida(t) || !/acessa\s+o\s+ambiente/i.test(t)) {
        if (!out.slice(-5).some((l) => l.includes('acessa o ambiente'))) {
          out.push(dadoOk);
        }
        continue;
      }
      out.push(trimmed.replace(/^\s*/, '  '));
      continue;
    }

    if (/^\s*quando\s+/i.test(t)) {
      if (passoEhVago(t) || /inicia a ação principal|fluxo complementar/i.test(t)) {
        if (quandoFallback) {
          out.push(quandoFallback);
          temQuandoNoCenario = true;
        }
        continue;
      }
      out.push(trimmed.replace(/^\s*/, '  '));
      temQuandoNoCenario = true;
      continue;
    }

    if (/^\s*e\s+/i.test(t) && !/^\s*então/i.test(t)) {
      if (temEntaoNoCenario) continue;
      if (linhaEInvalida(t) || passoEhVago(t)) continue;
      if (/^e\s+o\s+usu[aá]rio\s+informa dado inv[aá]lid/i.test(t)) continue;
      if (/^e\s+o\s+usu[aá]rio\s+(ao|após|antes|quando)\s+/i.test(t)) continue;
      out.push(trimmed.replace(/^\s*/, '    '));
      continue;
    }

    if (/^\s*ent[aã]o\s+/i.test(t)) {
      const corpo = t.replace(/^\s*ent[aã]o\s+/i, '');
      if (entaoEhVago(corpo) || fraseEhIncompleta(corpo)) {
        if (entaoFallback) {
          out.push(entaoFallback);
          temEntaoNoCenario = true;
        }
        continue;
      }
      const ev = entaoVerificavel(corpo);
      if (ev && !fraseEhIncompleta(ev)) {
        out.push(`  Então ${ev}`);
      } else if (entaoFallback) {
        out.push(entaoFallback);
      } else {
        out.push(trimmed.replace(/^\s*/, '  '));
      }
      temEntaoNoCenario = true;
      continue;
    }

    if (/^\s*mas\s+/i.test(t)) {
      out.push(trimmed.replace(/^\s*/, '    '));
      continue;
    }

    if (passoEhColagemDescricao(t)) continue;
    const obj = trimmed.replace(/^\s*/, '    E ');
    if (!passoEhVago(obj)) out.push(obj);
  }

  flushCenarioDefaults();

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = {
  rigorEnabled,
  entaoEhVago,
  passoEhVago,
  entaoParaBlocoDev,
  quandoParaBlocoDev,
  extrairEntaoDoTexto,
  quandoSubstituto,
  entaoSubstituto,
  rigorizarFeatureBdd,
  VAGO_QUANDO,
  VAGO_ENTAO,
};
