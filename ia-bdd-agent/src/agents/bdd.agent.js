const path = require('path');
const fs = require('fs');
const { runIA, isLlmEnabled } = require('../services/ia.service');
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

function bddLlmOutputValido(texto) {
  if (!texto || typeof texto !== 'string') return false;
  const t = texto.trim();
  if (t.length < 40) return false;
  if (/^#\s*Não foi possível gerar BDD/i.test(t)) return false;
  if (/^#\s*Erro ao gerar BDD/i.test(t)) return false;
  if (!/funcionalidade\s*:/i.test(t) && !/cenário\s*:/i.test(t)) return false;
  return true;
}

async function generateBddViaLlm(title, ctx, description) {
  const promptPath = path.join(__dirname, '../../prompts/bdd.txt');
  const tpl = fs.readFileSync(promptPath, 'utf8');
  const input = montarInputLlm(title, ctx, description);
  const prompt = tpl.replace('{{INPUT}}', input);
  const raw = await runIA(prompt);
  return filtrarRespostaBdd(raw);
}

async function generateBDD(title, item) {
  const description = extractDescription(item);
  const ctx = extractTaskContext(item);

  if (!description.trim() && !ctxTemCamposEstruturados(ctx)) {
    return '# Não foi possível gerar BDD (sem título ou descrição utilizável no CRM)\n';
  }

  const structured = () => buildStructuredBdd(title, ctx);

  if (!isLlmEnabled()) {
    return structured();
  }

  try {
    const fromLlm = await generateBddViaLlm(title, ctx, description);
    if (bddLlmOutputValido(fromLlm)) {
      return fromLlm;
    }
    console.warn('[BDD] resposta OpenAI/LLM fora do padrão Gherkin — fallback estruturado');
  } catch (e) {
    console.warn(
      `[BDD] IA (${process.env.BDD_AI_PROVIDER || 'auto'}) falhou — fallback estruturado: ${e.message || e}`
    );
  }

  return structured();
}

function filtrarRespostaBdd(texto) {
  if (!texto || typeof texto !== 'string') return '';
  let t = texto.trim();

  const fence = t.match(/```(?:gherkin|feature)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) t = fence[1].trim();

  t = t.replace(/^[\s\S]*?(?=funcionalidade\s*:|cenário\s*:)/i, '');

  const idxFunc = t.search(/funcionalidade\s*:/i);
  const idxCen = t.search(/cenário\s*:/i);
  const start = idxFunc >= 0 ? idxFunc : idxCen >= 0 ? idxCen : 0;
  const cortado = t.slice(start).trim() || t;

  const semMeta = cortado
    .split(/\r?\n/)
    .filter((line) => {
      const l = line.trim();
      if (!l) return true;
      if (/^(claro|aqui está|segue|note que|com base)/i.test(l)) return false;
      if (/^#{1,2}\s+(?!cenário|funcionalidade)/i.test(l)) return false;
      return true;
    })
    .join('\n');

  return sanitizarFeatureBdd(semMeta);
}

module.exports = { generateBDD, buildStructuredBdd, filtrarRespostaBdd, bddLlmOutputValido };
