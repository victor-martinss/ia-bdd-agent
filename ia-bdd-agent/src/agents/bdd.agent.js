const path = require('path');
const fs = require('fs');
const { runIA } = require('../services/ia.service');
const { extractDescription, extractTaskContext } = require('./parser');
const {
  objetivarFrase,
  primeiraFrase,
  passosParaStepsGherkin,
  devCenariosParaPassosE,
  montarDadosIniciais,
  ctxTemCamposEstruturados,
  passosAPartirDoTitulo,
  entaoAPartirDoTitulo,
  resolverPassosReproducao,
  sanitizarFeatureBdd,
} = require('../utils/bdd-gherkin');

/**
 * BDD determinístico a partir dos campos do CRM (sem LLM).
 * Cenários objetivos em Dado / Quando / Então / E — sem colar descrições inteiras.
 */
function buildStructuredBdd(title, ctx) {
  const nomeFuncionalidade = ctx.titulo || title;
  const out = [];

  out.push(`Funcionalidade: ${nomeFuncionalidade}`);
  out.push('');

  const soTitulo = !ctxTemCamposEstruturados(ctx);

  out.push(`Cenário: ${nomeFuncionalidade} — validação principal`);
  out.push(...montarDadosIniciais(ctx));
  out.push(...devCenariosParaPassosE(ctx.cenariosTesteDev));

  if (soTitulo) {
    out.push(...passosAPartirDoTitulo(nomeFuncionalidade));
    out.push(entaoAPartirDoTitulo(nomeFuncionalidade));
  } else {
    out.push(...passosParaStepsGherkin(resolverPassosReproducao(ctx)));
    if (ctx.resultadoEsperado) {
      const entao = objetivarFrase(primeiraFrase(ctx.resultadoEsperado));
      out.push(
        entao
          ? `  Então ${entao}`
          : '  Então o sistema deve exibir o resultado esperado para o fluxo'
      );
    } else {
      out.push('  Então o comportamento deve estar alinhado à regra de negócio do chamado');
    }
  }
  out.push('');

  if (ctx.resultadoObtido && ctx.resultadoEsperado) {
    out.push(`Cenário: ${nomeFuncionalidade} — comportamento observado (defeito)`);
    out.push('  Dado que o cenário principal foi executado');
    out.push('  Quando o fluxo é concluído');
    const obtido = objetivarFrase(primeiraFrase(ctx.resultadoObtido));
    const esperado = objetivarFrase(primeiraFrase(ctx.resultadoEsperado));
    if (obtido) out.push(`  Então o sistema apresenta o defeito: ${obtido}`);
    if (esperado) out.push(`    Mas o esperado era: ${esperado}`);
    out.push('');
  }

  if (ctx.sugestaoMelhoria || ctx.motivoMelhoria) {
    out.push(`Cenário: ${nomeFuncionalidade} — melhoria sugerida`);
    out.push('  Dado que o time analisou o chamado');
    if (ctx.motivoMelhoria) {
      const motivo = objetivarFrase(ctx.motivoMelhoria);
      if (motivo) out.push(`    E o motivo registrado é: ${motivo}`);
    }
    if (ctx.sugestaoMelhoria) {
      const melhoria = objetivarFrase(ctx.sugestaoMelhoria);
      if (melhoria) out.push(`  Quando a melhoria for implementada: ${melhoria}`);
    }
    out.push('  Então o sistema deve atender ao objetivo da melhoria sem regressões no fluxo existente');
    out.push('');
  }

  return sanitizarFeatureBdd(out.join('\n'));
}

async function generateBDD(title, item) {
  const description = extractDescription(item);
  const ctx = extractTaskContext(item);

  if (!description.trim()) {
    return '# Não foi possível gerar BDD (sem título ou descrição utilizável no CRM)\n';
  }

  const useLlm =
    process.env.BDD_USE_LLM === '1' &&
    process.env.OLLAMA_URL &&
    process.env.MODEL;

  if (useLlm) {
    const promptPath = path.join(__dirname, '../../prompts/bdd.txt');
    const tpl = fs.readFileSync(promptPath, 'utf8');
    const input = `Título: ${title}\n\n${description}`;
    const prompt = tpl.replace('{{INPUT}}', input);
    const raw = await runIA(prompt);
    return filtrarRespostaBdd(raw);
  }

  return buildStructuredBdd(title, ctx);
}

/**
 * Mantém só bloco Gherkin útil (remove lixo antes/depois se o modelo falar demais).
 */
function filtrarRespostaBdd(texto) {
  if (!texto || typeof texto !== 'string') return String(texto);
  const t = texto.trim();
  const idxFunc = t.search(/funcionalidade\s*:/i);
  const idxCen = t.search(/cenário\s*:/i);
  const start = idxFunc >= 0 ? idxFunc : idxCen >= 0 ? idxCen : 0;
  const cortado = t.slice(start).trim() || t;
  return sanitizarFeatureBdd(cortado);
}

module.exports = { generateBDD, buildStructuredBdd };
