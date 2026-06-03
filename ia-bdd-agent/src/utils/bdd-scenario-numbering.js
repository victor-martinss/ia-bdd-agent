/**
 * Numeração sequencial dos cenários QA (Cenário 1:, Cenário 2:, …).
 */

const RE_LINHA_CENARIO = /^cen[aá]rio\s*(?:\d+\s*)?:\s*/i;
const RE_PREFIXO_NUMERO = /^cen[aá]rio\s+\d+\s*:\s*/i;

function numeracaoHabilitada() {
  return process.env.BDD_SCENARIO_NUMBERING !== '0';
}

function isLinhaCenario(linha) {
  return RE_LINHA_CENARIO.test(String(linha || '').trim());
}

/** Remove "Cenário:" ou "Cenário N:" do título. */
function stripPrefixoNumericoCenario(titulo) {
  return String(titulo || '')
    .trim()
    .replace(RE_PREFIXO_NUMERO, '')
    .replace(/^cen[aá]rio\s*:\s*/i, '')
    .trim();
}

function formatarLinhaCenarioNumerada(numero, titulo) {
  const base = stripPrefixoNumericoCenario(titulo);
  return `Cenário ${numero}: ${base}`;
}

/**
 * @param {{ titulo: string, linhas: string[], texto?: string }[]} cenarios
 */
function numerarCenariosObjeto(cenarios) {
  if (!numeracaoHabilitada()) return cenarios;
  return cenarios.map((cen, idx) => {
    const n = idx + 1;
    const linhas = [...cen.linhas];
    if (linhas.length && isLinhaCenario(linhas[0])) {
      const tituloBruto = linhas[0].replace(RE_LINHA_CENARIO, '').trim();
      linhas[0] = formatarLinhaCenarioNumerada(n, tituloBruto);
    }
    const titulo = stripPrefixoNumericoCenario(cen.titulo || linhas[0] || '');
    return {
      ...cen,
      titulo,
      linhas,
      texto: linhas.join('\n'),
      _numero: n,
    };
  });
}

/**
 * @param {string} feature
 * @param {{ parseFeatureEmCenarios: Function }} [deps]
 */
function numerarCenariosNaFeature(feature, deps = {}) {
  if (!numeracaoHabilitada() || !feature) return feature;
  const parse =
    deps.parseFeatureEmCenarios ||
    require('./bdd-scenario-planner').parseFeatureEmCenarios;

  const { header, cenarios } = parse(feature);
  if (!cenarios.length) return feature;

  const numerados = numerarCenariosObjeto(cenarios);
  const out = [...header];
  if (header.length && header[header.length - 1].trim()) out.push('');
  for (const cen of numerados) {
    out.push(...cen.linhas, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function extrairNumeroCenario(linha) {
  const m = String(linha || '').trim().match(/^cen[aá]rio\s+(\d+)\s*:/i);
  return m ? Number.parseInt(m[1], 10) : null;
}

module.exports = {
  numeracaoHabilitada,
  isLinhaCenario,
  RE_LINHA_CENARIO,
  stripPrefixoNumericoCenario,
  formatarLinhaCenarioNumerada,
  numerarCenariosObjeto,
  numerarCenariosNaFeature,
  extrairNumeroCenario,
};
