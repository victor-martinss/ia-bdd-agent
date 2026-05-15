const path = require('path');
const fs = require('fs');
const { runIA } = require('../services/ia.service');
const { extractDescription, extractTaskContext } = require('./parser');
const {
  objetivarFrase,
  passosParaStepsGherkin,
  devCenariosParaPassosE,
  montarDadosIniciais,
  ctxTemCamposEstruturados,
  passosAPartirDoTitulo,
  entaoAPartirDoTitulo,
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
    out.push(...passosParaStepsGherkin(ctx.passos));
    if (ctx.resultadoEsperado) {
      const entao = objetivarFrase(ctx.resultadoEsperado);
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
    const obtido = objetivarFrase(ctx.resultadoObtido);
    const esperado = objetivarFrase(ctx.resultadoEsperado);
    if (obtido) out.push(`  Então o sistema apresenta: ${obtido}`);
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

  return out.join('\n').trimEnd() + '\n';
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
  return t.slice(start).trim() || t;
}

module.exports = { generateBDD, buildStructuredBdd };
