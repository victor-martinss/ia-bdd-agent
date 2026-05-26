const { runIA, isLlmEnabled } = require('../services/ia.service');
const { buildBddPrompt } = require('../utils/bdd-prompts');
const { extractTaskContext } = require('./parser');
const { detectAmbiente, onlyTitleAndDevSources } = require('../utils/bdd-ambiente');
const { enrichCtxWithEvidence, aplicarFiltroContexto } = require('../utils/bdd-context');
const { formatarValidacoesParaPrompt } = require('../utils/bdd-validacoes');
const { planificarFeatureBdd } = require('../utils/bdd-scenario-planner');
const { resumoHistoricoParaBdd } = require('../services/crm-qa-history');
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
  cenariosQaAPartirDoDev,
  passosParaStepsGherkinComContinuacao,
  dividirCenarioCompletoPorMaxE,
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
      for (const linhas of cenariosQaAPartirDoDev(bloco, ctx, nomeFuncionalidade)) {
        out.push(...linhas);
        out.push('');
      }
    }
  } else if (limparTexto(ctx.titulo)) {
    const partes = String(nomeFuncionalidade).split(/\s*—\s*/);
    const foco =
      partes.length > 1 ? partes.slice(1).join(' — ').slice(0, 80) : nomeFuncionalidade;
    const titulo = `${foco} — validação principal`;
    const corpo = [...montarDadosIniciais(ctx)];
    if (limparTexto(ctx.cenariosTesteDev)) {
      corpo.push(...devCenariosParaPassosE(ctx.cenariosTesteDev));
    }
    corpo.push(...passosAPartirDoTitulo(nomeFuncionalidade));
    corpo.push(entaoAPartirDoTitulo(nomeFuncionalidade));
    for (const linhas of dividirCenarioCompletoPorMaxE(titulo, corpo)) {
      out.push(...linhas);
      out.push('');
    }
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
      const { cenariosPrincipalNgf } = require('../utils/bdd-gherkin');
      for (const linhas of cenariosPrincipalNgf(ctx, nomeFuncionalidade)) {
        out.push(...linhas);
        out.push('');
      }
    }
    if (ctx.resultadoObtido && ctx.resultadoEsperado) {
      const { entaoVerificavel, resolverPassosReproducao } = require('../utils/bdd-gherkin');
      const titulo = `${nomeFuncionalidadeCurto(nomeFuncionalidade)} — defeito observado`;
      const obtido = entaoVerificavel(ctx.resultadoObtido);
      const esperado = entaoVerificavel(ctx.resultadoEsperado);
      const entao = obtido ? `  Então ${obtido}` : '  Então o defeito descrito é reproduzido';
      const mas = esperado ? `    Mas o esperado era ${esperado}` : null;
      const chunks = passosParaStepsGherkinComContinuacao(resolverPassosReproducao(ctx));
      const partes =
        chunks.length > 0
          ? chunks.map((passos, idx) => {
              const suffix = idx > 0 ? ` — continuação` : '';
              const linhas = [
                `Cenário: ${titulo}${suffix}`,
                ...montarDadosIniciais(ctx),
                ...passos,
              ];
              if (idx === chunks.length - 1) {
                linhas.push(entao);
                if (mas) linhas.push(mas);
              }
              return linhas;
            })
          : dividirCenarioCompletoPorMaxE(titulo, [
              ...montarDadosIniciais(ctx),
              '  Quando o usuário reproduz o fluxo do chamado',
              entao,
              ...(mas ? [mas] : []),
            ]);
      for (const linhas of partes) {
        out.push(...linhas);
        out.push('');
      }
    }
  }

  const feature = sanitizarFeatureBdd(out.join('\n'));
  return finalizarFeatureBdd(feature, ctx, {
    qtdDev: blocosDev.length,
  });
}

function finalizarFeatureBdd(feature, ctx, meta = {}) {
  if (!feature) return feature;
  return planificarFeatureBdd(feature, ctx, meta);
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
      '- Resuma em 1 Quando + até 3 "E"; agrupe ações parecidas em um passo objetivo.',
      '- Evite muitos "E" seguidos; prefira verbos de negócio (localiza, compara, confirma).',
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
    '- Analise descrição, passos, resultados, evidências e histórico QA ANTES de escrever.',
    '- Cada Então = critério verificável (valor, mensagem, elemento visível na tela).',
    '- Dado que o usuário acessa o ambiente [nome] em todo cenário.',
    '- Resuma: 1 Quando + até 3 "E" objetivos; sem micro-cliques nem texto administrativo.',
    '- NÃO repita cenários com mesmo fluxo/Então; una redundâncias.',
    '- ORDEM de saída: (1) reprodução do defeito se houver, (2) cenários Dev na ordem, (3) lacunas do chamado, (4) cobertura extra por risco.',
    '- Lacunas: inclua cenário só se validação do chamado/evidência não estiver coberta.',
    '- Converta cada cenário Dev; extras só quando agregarem risco real ao chamado.'
  );

  if (ctx.resumoObjetivo) partes.push('\nResumo objetivo do teste:\n' + ctx.resumoObjetivo);
  if (ctx.qaHistorico?.isRetornoQa) {
    partes.push(
      '\nHistórico QA (priorizar regressão):',
      ctx.qaHistorico.reason || 'retorno após ciclo de testes'
    );
    if (ctx.observacoesTriagemFiltrada) {
      partes.push('Observações triagem: ' + ctx.observacoesTriagemFiltrada);
    }
  }
  if (ctx.descricaoFiltrada || ctx.descricao) {
    partes.push('\nDescrição (filtrada):\n' + (ctx.descricaoFiltrada || ctx.descricao));
  }
  if (ctx.passosFiltrados || ctx.passos) {
    partes.push('\nPassos para reproduzir:\n' + (ctx.passosFiltrados || ctx.passos));
  }
  if (ctx.passosObjetivos?.length) {
    partes.push('\nPassos objetivos extraídos:\n' + ctx.passosObjetivos.map((p, i) => `${i + 1}. ${p}`).join('\n'));
  }
  if (ctx.resultadoEsperado) partes.push('\nResultado esperado:\n' + ctx.resultadoEsperado);
  if (ctx.resultadoObtido) partes.push('\nResultado obtido (defeito):\n' + ctx.resultadoObtido);
  const ev = ctx.evidenceResumoFiltrado || ctx.evidenceResumo;
  if (ev) partes.push('\nAnálise de evidências Dev (imagens/vídeos):\n' + ev);
  if (ctx.elementosTelaEvidencia?.length) {
    partes.push('\nElementos visíveis nas evidências:\n' + ctx.elementosTelaEvidencia.join(', '));
  }

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

async function generateBddViaLlm(title, ctx, meta = {}) {
  const input = montarInputLlm(title, ctx);
  const { prompt, resolved } = buildBddPrompt(input, { ctx, title });

  if (process.env.DEBUG_BITRIX === '1') {
    console.log(
      `[BDD] Prompt: ${resolved.mode} (${resolved.file}) — ${resolved.label} | ambiente: ${ctx.ambiente?.label || '?'}`
    );
  }

  const raw = await runIA(prompt);
  return filtrarRespostaBdd(raw, ctx, meta);
}

async function prepararCtxBdd(title, item) {
  const fullCtx = extractTaskContext(item);
  let ctx = await enrichCtxWithEvidence(fullCtx, item, title);

  try {
    const qaHistorico = await resumoHistoricoParaBdd(item);
    ctx.qaHistorico = qaHistorico;
    if (qaHistorico.observacoesTriagem && !ctx.observacoesTriagem) {
      ctx.observacoesTriagem = qaHistorico.observacoesTriagem;
    }
  } catch (e) {
    if (process.env.DEBUG_BITRIX === '1') {
      console.warn('[BDD] histórico QA:', e.message || e);
    }
    ctx.qaHistorico = { isRetornoQa: false, reason: '' };
  }

  ctx = aplicarFiltroContexto(ctx);
  return ctx;
}

async function generateBDD(title, item) {
  const ctx = await prepararCtxBdd(title, item);

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

  const blocosDev = parseCenariosDevBlocos(ctx.cenariosTesteDev);
  ctx._ordemDev = blocosDev.map((b) => b.title || '').filter(Boolean);

  const structured = () => buildStructuredBdd(title, ctx);

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

  const cardSoTitulo =
    blocosDev.length === 0 &&
    !ctxTemCamposEstruturados(ctx) &&
    limparTexto(ctx.titulo || title);

  if (cardSoTitulo) {
    return structured();
  }

  if (!isLlmEnabled()) {
    return structured();
  }

  try {
    const fromLlm = await generateBddViaLlm(title, ctx, { qtdDev: blocosDev.length });
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

function filtrarRespostaBdd(texto, ctx = {}, meta = {}) {
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

  const normalizado = cortado.replace(/^\s*E\s+cen[aá]rio\s*:/gim, 'Cenário:');

  const semMeta = normalizado
    .split(/\r?\n/)
    .filter((line) => {
      const l = line.trim();
      if (!l) return true;
      if (/^(claro|aqui está|segue|note que|com base)/i.test(l)) return false;
      if (/^#{1,2}\s+(?!cenário|funcionalidade|cenários)/i.test(l)) return false;
      return true;
    })
    .join('\n');

  const limpo = sanitizarFeatureBdd(semMeta);
  const blocosDev = parseCenariosDevBlocos(ctx.cenariosTesteDev);
  return finalizarFeatureBdd(limpo, ctx, { qtdDev: blocosDev.length });
}

module.exports = {
  generateBDD,
  prepararCtxBdd,
  buildStructuredBdd,
  prepareCtxForBdd,
  filtrarRespostaBdd,
  finalizarFeatureBdd,
  bddLlmOutputValido,
};
