const { buildStructuredBdd } = require('../src/agents/bdd.agent');
const { detectAmbiente } = require('../src/utils/bdd-ambiente');
const { cleanGherkinForCrmField, fieldHasMalformedLlmGherkin } = require('../src/utils/bdd-crm-merge');
const { parseTituloParaCenario } = require('../src/utils/bdd-gherkin');

const titulo =
  'Sustentação - Desenvolvimento Web - Portal Mobilemed  Campo CNPJ obrigatório indevidamente ao selecionar tipo “Pessoa Física” no cadastro de unidades';

console.log('Parsed:', parseTituloParaCenario(titulo));

const ctx = {
  titulo,
  ambiente: detectAmbiente(titulo, ''),
};

const raw = buildStructuredBdd(titulo, ctx);
const crm = cleanGherkinForCrmField(raw);

console.log('\n--- RAW ---\n');
console.log(raw);
console.log('\n--- CRM (limpo) ---\n');
console.log(crm);
const { validarEstruturaFeatureGherkin } = require('../src/utils/bdd-gherkin-structure');
console.log('\nValid CRM:', validarEstruturaFeatureGherkin(crm));
console.log('Malformado:', fieldHasMalformedLlmGherkin(crm));
console.log('Tem #:', /^#/m.test(crm));
console.log('Tem …:', /…/.test(crm));
