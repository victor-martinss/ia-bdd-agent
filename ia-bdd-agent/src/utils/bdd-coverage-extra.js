const { detectAmbiente, dadoAcessaAmbiente } = require('./bdd-ambiente');
const { limparTexto, passosParaStepsGherkin, nomeFuncionalidadeCurto } = require('./bdd-gherkin');
const { extrairValidacoesExatas } = require('./bdd-validacoes');

function coverageExtraEnabled() {
  return process.env.BDD_COVERAGE_EXTRA !== '0';
}

function maxCenariosExtras() {
  const n = Number.parseInt(process.env.BDD_COVERAGE_MAX_EXTRA || '3', 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 6) : 3;
}

function textoConsolidado(ctx, blocosDev) {
  const partes = [
    ctx.titulo,
    ctx.descricao,
    ctx.passos,
    ctx.resultadoEsperado,
    ctx.evidenceResumo,
    ctx.cenariosTesteDev,
    ...(blocosDev || []).map((b) => `${b.title || ''}\n${b.body || ''}`),
  ];
  return partes.join('\n').toLowerCase();
}

function entaoExtraAssertivo(ctx, fallback) {
  if (process.env.BDD_ASSERTIVE_MODE === '0') return fallback;
  const vals = extrairValidacoesExatas(ctx);
  if (vals.length) return `  Então ${vals[0].entao}`;
  return fallback;
}

function devJaCobre(todosBlocos, padroes) {
  const blob = textoConsolidado({ cenariosTesteDev: '' }, todosBlocos);
  return padroes.some((p) => p.test(blob));
}

function montarCenarioExtra(titulo, ctx, passosTexto, entao) {
  const linhas = [
    `Cenário: ${titulo}`,
    dadoAcessaAmbiente(ctx.ambiente || detectAmbiente(ctx.titulo, ctx.cenariosTesteDev)),
  ];
  const quando = passosParaStepsGherkin(passosTexto);
  if (quando.length) linhas.push(...quando);
  else linhas.push('  Quando o usuário executa o fluxo complementar de cobertura');
  linhas.push(entao || '  Então o comportamento esperado é observado na tela sem erro');
  return linhas;
}

/**
 * Cenários QA complementares (além dos blocos do campo Cenários Dev).
 * @param {object} ctx
 * @param {{ title: string|null, body: string, lines: string[] }[]} blocosDev
 * @param {string} nomeFuncionalidade
 * @returns {string[][]} lista de linhas por cenário
 */
function gerarCenariosCoberturaExtra(ctx, blocosDev, nomeFuncionalidade) {
  if (!coverageExtraEnabled()) return [];

  const max = maxCenariosExtras();
  const candidatos = [];
  const t = textoConsolidado(ctx, blocosDev);
  const foco = nomeFuncionalidadeCurto(nomeFuncionalidade);
  const amb = ctx.ambiente || detectAmbiente(ctx.titulo, ctx.cenariosTesteDev);

  if (
    !devJaCobre(blocosDev, [/smoke/i, /acesso\s+ao\s+ambiente/i, /acesso\s+inicial/i])
  ) {
    candidatos.push(
      montarCenarioExtra(
        `Cobertura — smoke de acesso (${amb.label})`,
        ctx,
        `acessar a tela principal de ${foco}`,
        entaoExtraAssertivo(
          ctx,
          `  Então a tela principal de ${amb.label} é exibida sem mensagem de erro de sistema`
        )
      )
    );
  }

  if (
    (t.includes('worklist') && t.includes('portal')) ||
    (t.includes('protocolo') && (t.includes('sincron') || t.includes('compar')))
  ) {
    if (!devJaCobre(blocosDev, [/compar/i, /sincron/i, /entre\s+.*portal/i])) {
      candidatos.push(
        montarCenarioExtra(
          'Cobertura — consistência entre sistemas',
          ctx,
          'registrar o valor exibido no primeiro sistema\nabrir o mesmo registro no segundo sistema\ncomparar o mesmo campo entre os dois ambientes',
          '  Então os dados exibidos são consistentes entre os ambientes consultados'
        )
      );
    }
  }

  if (
    !devJaCobre(blocosDev, [/inv[aá]lid/i, /negativ/i, /erro\s+de\s+valida/i, /campo\s+obrigat/i])
  ) {
    if (/\b(cpf|cadastro|protocolo|paciente|formul[aá]rio|preench)\b/i.test(t)) {
      candidatos.push(
        montarCenarioExtra(
          'Cobertura — validação com dado inválido',
          ctx,
          'iniciar o fluxo principal do chamado\ninformar dado inválido ou deixar campo obrigatório vazio\nconfirmar ou salvar',
          '  Então uma mensagem de validação é exibida e o fluxo não conclui incorretamente'
        )
      );
    }
  }

  if (!devJaCobre(blocosDev, [/cancel/i, /interromp/i, /sair\s+sem/i, /fechar\s+sem/i])) {
    if (/\b(laud[aá]rio|grava[çc][aã]o|salvar|exportar|enviar)\b/i.test(t)) {
      candidatos.push(
        montarCenarioExtra(
          'Cobertura — interrupção do fluxo',
          ctx,
          'iniciar a ação principal do chamado\ninterromper ou sair sem concluir a operação',
          '  Então o sistema não apresenta erro indevido nem perda inconsistente de dados'
        )
      );
    }
  }

  if (!devJaCobre(blocosDev, [/permiss[aã]o|n[aã]o\s+autorizado|acesso\s+negado/i])) {
    if (/\b(perfil|permiss[aã]o|usu[aá]rio\s+sem)\b/i.test(t)) {
      candidatos.push(
        montarCenarioExtra(
          'Cobertura — usuário sem permissão',
          ctx,
          'acessar o módulo com usuário de perfil restrito\ntentar executar a ação do chamado',
          '  Então o acesso é bloqueado ou a ação não é permitida conforme regra de perfil'
        )
      );
    }
  }

  if (
    !devJaCobre(blocosDev, [/lista\s+vazia|nenhum\s+registro|sem\s+exame|edge/i]) &&
    /\b(lista|filtro|pesquisa|worklist|grid)\b/i.test(t)
  ) {
    candidatos.push(
      montarCenarioExtra(
        'Cobertura — lista sem registros',
        ctx,
        'aplicar filtro que não retorna resultados\nvisualizar a área de listagem',
        '  Então é exibido estado vazio ou mensagem informativa sem erro de sistema'
      )
    );
  }

  const vistos = new Set();
  const unicos = [];
  for (const c of candidatos) {
    const titulo = (c[0] || '').replace(/^Cenário:\s*/i, '').trim();
    if (vistos.has(titulo)) continue;
    vistos.add(titulo);
    unicos.push(c);
    if (unicos.length >= max) break;
  }

  return unicos;
}

/**
 * Cabeçalho informativo (comentário Gherkin) sobre cobertura.
 */
function cabecalhoCobertura(qtdDev, qtdExtra) {
  if (!coverageExtraEnabled() || qtdExtra === 0) {
    return `# Cenários QA: ${qtdDev} baseado(s) em Cenários Dev\n`;
  }
  return (
    `# Cenários QA: ${qtdDev} do campo Cenários Dev + ${qtdExtra} complementar(es) de cobertura\n`
  );
}

module.exports = {
  coverageExtraEnabled,
  maxCenariosExtras,
  gerarCenariosCoberturaExtra,
  cabecalhoCobertura,
};
