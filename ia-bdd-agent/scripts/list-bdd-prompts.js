#!/usr/bin/env node
require('../load-env');
const { listPromptModes, detectPromptMode, resolveBddPrompt } = require('../src/utils/bdd-prompts');

console.log('Prompts BDD disponíveis:\n');
for (const row of listPromptModes()) {
  console.log(`  ${row.id.padEnd(18)} → ${row.file}`);
  console.log(`    ${row.label}\n`);
}

const sampleTitle = process.argv[2] || 'Worklist - Protocolo Portal';
const sampleCtx = {
  passos: process.argv[3] || 'worklist portal protocolo',
  resultadoObtido: process.argv[4] || '',
};

const mode = detectPromptMode(sampleCtx, sampleTitle);
const resolved = resolveBddPrompt({ ctx: sampleCtx, title: sampleTitle });

console.log('Exemplo de detecção automática:');
console.log(`  Título: ${sampleTitle}`);
console.log(`  Modo detectado: ${mode}`);
console.log(`  Arquivo usado: ${resolved.file}`);
console.log('\nUso: npm run bdd:prompts -- "Título" "texto passos" [resultadoObtido]');
console.log('Env: BDD_PROMPT_MODE=defeito | BDD_PROMPT_FILE=bdd-regressao.txt');
