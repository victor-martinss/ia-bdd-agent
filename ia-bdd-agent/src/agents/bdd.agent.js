const { runIA, isLlmEnabled } = require('../services/ia.service');
const { buildBddPrompt } = require('../utils/bdd-prompts');
const { extractTaskContext } = require('./parser');
const { detectAmbiente, onlyTitleAndDevSources } = require('../utils/bdd-ambiente');
const { enrichCtxWithEvidence } = require('../utils/bdd-context');
const { formatarValidacoesParaPrompt } = require('../utils/bdd-validacoes');
const {
  gerarCenariosCoberturaExtra,
  cabecalhoCobertura,
  coverageExtraEnabled,
} = require('../utils/bdd-coverage-extra');
const {
  passosParaStepsGherkin,
  devCenariosParaPassosE,
  montarDadosIniciais,
  ctxTemCamposEstruturados,
  passosAPartirDoTitulo,
  entaoAPartirDoTitulo,
  sanitizarFeatureBdd,
  parseCenariosDevBlocos,
  cenarioQaAPartirDoDev,
  nomeFuncionalidadeCurto,
  limparTexto,
} = require('../utils/bdd-gherkin');

/** @deprecated use enrichCtxWithEvidence — mantido para testes/scripts */
function prepareCtxForBdd(fullCtx, title) {
  const { prepareCtxSync } = require('../utils/bdd-context');
  return prepareCtxSync(fullCtx, title);
}

function ctxTemDadosParaBdd(ctx) {
  if (onlyTitleAndDevSources()) {
    return !!(limparTexto(ctx.titulo) || limparTexto(ctx.cenariosTesteDev));
  }
  return (
    ctxTemCamposEstruturados(ctx) ||
    !!limparTexto(ctx.titulo) ||
    !!limparTexto(ctx.cenariosTesteDev) ||
    !!limparTexto(ctx.descricao) ||
    !!limparTexto(ctx.passos) ||
    !!limparTexto(ctx.evidenceResumo)
  );
}

/**
 * BDD: cenários Dev → QA + cobertura complementar; Dado com ambiente detectado.
 */
function buildStructuredBdd(title, ctx) {
  const nomeFuncionalidade = nomeFuncionalidadeCurto(ctx.titulo || title);
  const blocosDev = parseCenariosDevBlocos(ctx.cenariosTesteDev);
  const out = [];

  const qtdExtra = coverageExtraEnabled()
    ? gerarCenariosCoberturaExtra(ctx, blocosDev, nomeFuncionalidade).length
    : 0;

  out.push(cabecalhoCobertura(blocosDev.length, qtdExtra).trimEnd());
  out.push(`Funcionalidade: ${nomeFuncionalidade}`);
  out.push('');

  if (blocosDev.length > 0) {
    for (const bloco of blocosDev) {
      out.push(...cenarioQaAPartirDoDev(bloco, ctx, nomeFuncionalidade));
      out.push('');
    }
  } else if (limparTexto(ctx.titulo)) {
    const partes = String(nomeFuncionalidade).split(/\s*—\s*/);
    const foco =
      partes.length > 1 ? partes.slice(1).join(' — ').slice(0, 80) : nomeFuncionalidade;
    out.push(`Cenário: ${foco} — validação principal`);
    out.push(...montarDadosIniciais(ctx));
    if (limparTexto(ctx.cenariosTesteDev)) {
      out.push(...devCenariosParaPassosE(ctx.cenariosTesteDev));
    }
    out.push(...passosAPartirDoTitulo(nomeFuncionalidade));
    out.push(entaoAPartirDoTitulo(nomeFuncionalidade));
    out.push('');
  }

  if (coverageExtraEnabled()) {
    const extras = gerarCenariosCoberturaExtra(ctx, blocosDev, nomeFuncionalidade);
    for (const linhas of extras) {
      out.push(...linhas);
      out.push('');
    }
  }

  if (!onlyTitleAndDevSources()) {
    const temNgf = ctxTemCamposEstruturados(ctx);
    if (temNgf && blocosDev.length === 0) {
      const { cenarioPrincipalNgf } = require('../utils/bdd-gherkin');
      out.push(...cenarioPrincipalNgf(ctx, nomeFuncionalidade));
      out.push('');
    }
    if (ctx.resultadoObtido && ctx.resultadoEsperado) {
      const { entaoVerificavel, resolverPassosReproducao } = require('../utils/bdd-gherkin');
      out.push(`Cenário: ${nomeFuncionalidade} — defeito observado`);
      out.push(...montarDadosIniciais(ctx));
      const quando = passosParaStepsGherkin(resolverPassosReproducao(ctx));
      if (quando.length) out.push(...quando);
      else out.push('  Quando o usuário reproduz o fluxo do chamado');
      const obtido = entaoVerificavel(ctx.resultadoObtido);
      const esperado = entaoVerificavel(ctx.resultadoEsperado);
      if (obtido) out.push(`  Então ${obtido}`);
      if (esperado) out.push(`    Mas o esperado era ${esperado}`);
      out.push('');
    }
  }

  return sanitizarFeatureBdd(out.join('\n'));
}

function montarInputLlm(title, ctx) {
  const amb = ctx.ambiente || detectAmbiente(ctx.titulo || title, ctx.cenariosTesteDev);
  const partes = [
    `Título: ${title || ctx.titulo}`,
    `Ambiente detectado (obrigatório no Dado): ${amb.label}`,
  ];

  if (onlyTitleAndDevSources()) {
    partes.push(
      '',
      'INSTRUÇÕES:',
      '- Use SOMENTE o título e os Cenários de Teste (Dev) abaixo como fonte.',
      '- Primeira linha de cada cenário: Dado que o usuário acessa o ambiente [nome do ambiente].',
      '- Converta CADA cenário Dev em um cenário QA equivalente.',
      '- Além dos cenários Dev, inclua cenários COMPLEMENTARES de cobertura.',
      '- Não use descrição, passos NGF nem resultado esperado do CRM (não fornecidos).'
    );
    if (ctx.cenariosTesteDev) {
      partes.push('\nCenários de Teste (Dev):\n' + ctx.cenariosTesteDev);
    } else {
      partes.push('\n(Sem Cenários Dev — derive cenários mínimos a partir do título.)');
    }
    return partes.join('\n');
  }

  partes.push(
    '',
    'INSTRUÇÕES (modo assertivo):',
    '- Analise descrição, passos, resultados e evidências ANTES de escrever os cenários.',
    '- Cada Então deve ser critério verificável (valor, mensagem, presença/ausência na tela).',
    '- Dado que o usuário acessa o ambiente [nome] em todo cenário.',
    '- Converta cada cenário Dev + inclua cobertura extra com Então específicos ao chamado.'
  );

  if (ctx.descricao) partes.push('\nDescrição:\n' + ctx.descricao);
  if (ctx.passos) partes.push('\nPassos para reproduzir:\n' + ctx.passos);
  if (ctx.resultadoEsperado) partes.push('\nResultado esperado:\n' + ctx.resultadoEsperado);
  if (ctx.resultadoObtido) partes.push('\nResultado obtido (defeito):\n' + ctx.resultadoObtido);
  if (ctx.evidenceResumo) partes.push('\nAnálise de evidências Dev (imagens/vídeos):\n' + ctx.evidenceResumo);

  const vals = formatarValidacoesParaPrompt(ctx);
  if (vals) partes.push('\nValidações exatas a refletir nos Então:\n' + vals);

  if (ctx.cenariosTesteDev) {
    partes.push('\nCenários de Teste (Dev):\n' + ctx.cenariosTesteDev);
  }

  return partes.join('\n');
}

const PASSOS_BLOQUEADOS_LLM =
  /passos?\s+para\s+reproduzir|cen[aá]rio\s+principal\s+foi\s+executado|fluxo\s+[eé]\s+conclu[ií]do|sistema\s+est[aá]\s+em\s+opera[çc][aã]o/i;

function bddLlmOutputValido(texto) {
  if (!texto || typeof texto !== 'string') return false;
  const t = texto.trim();
  if (t.length < 40) return false;
  if (/^#\s*Não foi possível gerar BDD/i.test(t)) return false;
  if (/^#\s*Erro ao gerar BDD/i.test(t)) return false;
  if (!/funcionalidade\s*:/i.test(t) && !/cenário\s*:/i.test(t)) return false;
  if (PASSOS_BLOQUEADOS_LLM.test(t)) return false;
  if (/tarefa\s+aberta|evid[eê]ncias?\s+enviadas/i.test(t)) return false;
  if (!/acessa\s+o\s+ambiente/i.test(t)) return false;
  return true;
}

async function generateBddViaLlm(title, ctx) {
  const input = montarInputLlm(title, ctx);
  const { prompt, resolved } = buildBddPrompt(input, { ctx, title });

  if (process.env.DEBUG_BITRIX === '1') {
    console.log(
      `[BDD] Prompt: ${resolved.mode} (${resolved.file}) — ${resolved.label} | ambiente: ${ctx.ambiente?.label || '?'}`
    );
  }

  const raw = await runIA(prompt);
  return filtrarRespostaBdd(raw);
}

async function generateBDD(title, item) {
  const fullCtx = extractTaskContext(item);
  const ctx = await enrichCtxWithEvidence(fullCtx, item, title);

  if (!ctxTemDadosParaBdd(ctx)) {
    return '# Não foi possível gerar BDD (sem título nem Cenários de Teste Dev no CRM)\n';
  }

  const fontes =
    ctx._fontes === 'assertive'
      ? 'assertivo (descrição + passos + resultados + evidências)'
      : onlyTitleAndDevSources()
        ? 'título + Dev'
        : 'completo';

  if (ctx.evidenceMeta?.arquivos > 0) {
    console.log(
      `[BDD] Evidências Dev: ${ctx.evidenceMeta.arquivos} arquivo(s), ${ctx.evidenceMeta.analisadas || 0} imagem(ns) com visão`
    );
  }

  if (process.env.DEBUG_BITRIX === '1') {
    console.log(
      `[BDD] Fontes: ${fontes} | ambiente: ${ctx.ambiente?.label || '?'} | evidências: ${ctx.evidenceMeta?.arquivos || 0}`
    );
  }

  const structured = () => buildStructuredBdd(title, ctx);
  const blocosDev = parseCenariosDevBlocos(ctx.cenariosTesteDev);

  const preferStructured =
    process.env.BDD_PREFER_STRUCTURED === '1' ||
    (blocosDev.length > 0 && !isLlmEnabled()) ||
    (blocosDev.length > 0 && process.env.BDD_ASSERTIVE_LLM !== '1');

  if (preferStructured && blocosDev.length > 0) {
    return structured();
  }

  if (blocosDev.length === 0 && process.env.BDD_PREFER_STRUCTURED === '1') {
    return structured();
  }

  if (!isLlmEnabled()) {
    return structured();
  }

  try {
    const fromLlm = await generateBddViaLlm(title, ctx);
    if (bddLlmOutputValido(fromLlm)) {
      return fromLlm;
    }
    console.warn('[BDD] resposta OpenAI/LLM fora do padrão — fallback estruturado');
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

  t = t.replace(/^[\s\S]*?(?=funcionalidade\s*:|cenário\s*:|#\s*cenários)/i, '');

  const idxFunc = t.search(/funcionalidade\s*:/i);
  const idxCen = t.search(/cenário\s*:/i);
  const idxHash = t.search(/^#\s*cenários/im);
  const start =
    idxHash >= 0 ? idxHash : idxFunc >= 0 ? idxFunc : idxCen >= 0 ? idxCen : 0;
  const cortado = t.slice(start).trim() || t;

  const semMeta = cortado
    .split(/\r?\n/)
    .filter((line) => {
      const l = line.trim();
      if (!l) return true;
      if (/^(claro|aqui está|segue|note que|com base)/i.test(l)) return false;
      if (/^#{1,2}\s+(?!cenário|funcionalidade|cenários)/i.test(l)) return false;
      return true;
    })
    .join('\n');

  return sanitizarFeatureBdd(semMeta);
}

module.exports = {
  generateBDD,
  buildStructuredBdd,
  prepareCtxForBdd,
  filtrarRespostaBdd,
  bddLlmOutputValido,
};
