const {
  repararFeatureGherkinDesconexo,
  validarEstruturaFeatureGherkin,
} = require('../src/utils/bdd-gherkin-structure');
const { extrairValidacoesExatas } = require('../src/utils/bdd-validacoes');
const { detectAmbiente } = require('../src/utils/bdd-ambiente');
const { fieldHasMalformedLlmGherkin } = require('../src/utils/bdd-crm-merge');

const sample = `Funcionalidade: Integração com Leorad via Portable

E cenário: Solicita nova autenticação ao retornar paciente da fila
Dado que o usuário acessa o ambiente Portable (Desktop)
E o usuário abre um exame disponível na Worklist
Quando o usuário alterna para o laudário
E o usuário tenta retornar ao exame na Worklist
Então a mensagem
E o laudo não é salvo
E o exame permanece visível na Worklist após 5 segundos`;

const ctx = {
  titulo: 'Integração Leorad Portable',
  ambiente: detectAmbiente('Portable Leorad', ''),
  resultadoEsperado:
    'Não solicitar nova autenticação. Laudo não salvo permanece. Exame visível na Worklist após 5 segundos.',
  passos: 'Abrir exame na Worklist, ir ao laudário, voltar à Worklist',
};

console.log('Validações extraídas:', extrairValidacoesExatas(ctx));
console.log('Malformado (antes):', fieldHasMalformedLlmGherkin(sample));

const out = repararFeatureGherkinDesconexo(sample, ctx);
console.log('\n--- REPARADO ---\n');
console.log(out);
console.log('Valid:', validarEstruturaFeatureGherkin(out));
console.log('Malformado (depois):', fieldHasMalformedLlmGherkin(out));
