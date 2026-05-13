const { runIA } = require('../services/ia.service');

async function generateCoverage(bdd) {
  const prompt = `Gere testes de cobertura avançados para:\n${bdd}`;
  return await runIA(prompt);
}

module.exports = { generateCoverage };