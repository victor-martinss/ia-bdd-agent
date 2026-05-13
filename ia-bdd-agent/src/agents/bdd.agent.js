const path = require('path');
const fs = require('fs');
const { runIA } = require('../services/ia.service');
const { extractDescription, extractTaskContext } = require('./parser');

function passosParaSteps(passos) {
  if (!passos || !passos.trim()) return ['  Quando o usuário executa o fluxo descrito no chamado'];
  const max =
    Number.parseInt(process.env.BDD_MAX_PASSO_LINES || '50', 10) || 50;
  const partes = passos
    .split(/\n+|(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const linhas = [];
  partes.slice(0, Math.max(1, max)).forEach((p, i) => {
    const prefix = i === 0 ? '  Quando ' : '    E ';
    linhas.push(`${prefix}${p.charAt(0).toLowerCase()}${p.slice(1)}`);
  });
  return linhas;
}

/**
 * BDD determinístico a partir dos campos do CRM (sem LLM).
 */
function buildStructuredBdd(title, ctx) {
  const nomeFuncionalidade = ctx.titulo || title;
  const out = [];

  out.push(`Funcionalidade: ${nomeFuncionalidade}`);
  out.push('');

  out.push(`Cenário: ${nomeFuncionalidade} — validação principal`);
  out.push('  Dado que o sistema está em operação');
  if (ctx.descricao) {
    out.push('    E o contexto documentado no chamado é:');
    out.push('      """');
    for (const line of ctx.descricao.split(/\r?\n/)) {
      out.push(line);
    }
    out.push('      """');
  }
  out.push(...passosParaSteps(ctx.passos));
  if (ctx.resultadoEsperado) {
    out.push(`  Então ${ctx.resultadoEsperado}`);
  } else {
    out.push('  Então o comportamento deve estar alinhado à regra de negócio descrita no chamado');
  }
  out.push('');

  if (ctx.resultadoObtido && ctx.resultadoEsperado) {
    out.push(`Cenário: ${nomeFuncionalidade} — comportamento observado (defeito)`);
    out.push('  Dado que o cenário principal foi executado');
    out.push(`  Quando o fluxo é concluído`);
    out.push(`  Então o sistema apresenta: ${ctx.resultadoObtido}`);
    out.push(`    Mas o esperado era: ${ctx.resultadoEsperado}`);
    out.push('');
  }

  if (ctx.sugestaoMelhoria || ctx.motivoMelhoria) {
    out.push(`Cenário: ${nomeFuncionalidade} — melhoria sugerida`);
    out.push('  Dado que o time analisou o chamado');
    if (ctx.motivoMelhoria) out.push(`    E o motivo: ${ctx.motivoMelhoria}`);
    if (ctx.sugestaoMelhoria) out.push(`  Quando a melhoria "${ctx.sugestaoMelhoria}" for implementada`);
    out.push('  Então o sistema deve atender ao objetivo da melhoria sem regressões no fluxo existente');
    out.push('');
  }

  return out.join('\n');
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
