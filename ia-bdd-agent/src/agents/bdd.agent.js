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
  parseCenariosDevBlocos,
  cenarioQaAPartirDoDev,
  cenarioPrincipalNgf,
  entaoDoContexto,
} = require('../utils/bdd-gherkin');

/**
 * BDD determinístico: cenários Dev como modelo + descrição/passos/resultado da tarefa → cenários QA.
 */
function buildStructuredBdd(title, ctx) {
  const nomeFuncionalidade = ctx.titulo || title;
  const out = [];

  out.push(`Funcionalidade: ${nomeFuncionalidade}`);
  out.push('');

  const blocosDev = parseCenariosDevBlocos(ctx.cenariosTesteDev);
  const temNgf = ctxTemCamposEstruturados(ctx);
  const soTitulo = !temNgf && !blocosDev.length;

  if (blocosDev.length > 0) {
    for (const bloco of blocosDev) {
      out.push(...cenarioQaAPartirDoDev(bloco, ctx, nomeFuncionalidade));
      out.push('');
    }
  }

  if (temNgf && blocosDev.length === 0) {
    out.push(...cenarioPrincipalNgf(ctx, nomeFuncionalidade));
    out.push('');
  } else if (temNgf && blocosDev.length > 0) {
    const temPassosNgf =
      resolverPassosReproducao({
        ...ctx,
        cenariosTesteDev: '',
      }).trim().length > 0;
    if (temPassosNgf) {
      out.push(`Cenário: ${nomeFuncionalidade} — validação (descrição e passos da tarefa)`);
      out.push(...montarDadosIniciais(ctx));
      out.push(
        ...passosParaStepsGherkin(
          resolverPassosReproducao({ ...ctx, cenariosTesteDev: '' })
        )
      );
      out.push(entaoDoContexto(ctx));
      out.push('');
    }
  } else if (soTitulo) {
    out.push(`Cenário: ${nomeFuncionalidade} — validação principal`);
    out.push(...montarDadosIniciais(ctx));
    out.push(...devCenariosParaPassosE(ctx.cenariosTesteDev));
    out.push(...passosAPartirDoTitulo(nomeFuncionalidade));
    out.push(entaoAPartirDoTitulo(nomeFuncionalidade));
    out.push('');
  }

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
    out.push(
      '  Então o sistema deve atender ao objetivo da melhoria sem regressões no fluxo existente'
    );
    out.push('');
  }

  return sanitizarFeatureBdd(out.join('\n'));
}

function montarInputLlm(title, ctx, description) {
  const partes = [`Título: ${title}`];
  if (ctx.cenariosTesteDev) {
    partes.push(
      '\nCenários de Teste (Dev) — use como modelo principal para os cenários QA:\n' +
        ctx.cenariosTesteDev
    );
  }
  if (ctx.descricao) {
    partes.push('\nDescrição do ocorrido:\n' + ctx.descricao);
  }
  if (ctx.passos) {
    partes.push('\nPassos para reproduzir:\n' + ctx.passos);
  }
  if (ctx.resultadoEsperado) {
    partes.push('\nResultado esperado:\n' + ctx.resultadoEsperado);
  }
  if (ctx.resultadoObtido) {
    partes.push('\nResultado obtido:\n' + ctx.resultadoObtido);
  }
  if (!ctx.cenariosTesteDev && !ctx.descricao && !ctx.passos) {
    partes.push('\n' + description);
  }
  return partes.join('\n');
}

async function generateBDD(title, item) {
  const description = extractDescription(item);
  const ctx = extractTaskContext(item);

  if (!description.trim() && !ctxTemCamposEstruturados(ctx)) {
    return '# Não foi possível gerar BDD (sem título ou descrição utilizável no CRM)\n';
  }

  const useLlm =
    process.env.BDD_USE_LLM === '1' &&
    process.env.OLLAMA_URL &&
    process.env.MODEL;

  if (useLlm) {
    const promptPath = path.join(__dirname, '../../prompts/bdd.txt');
    const tpl = fs.readFileSync(promptPath, 'utf8');
    const input = montarInputLlm(title, ctx, description);
    const prompt = tpl.replace('{{INPUT}}', input);
    const raw = await runIA(prompt);
    return filtrarRespostaBdd(raw);
  }

  return buildStructuredBdd(title, ctx);
}

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
