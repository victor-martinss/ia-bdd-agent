const { runIA } = require('../services/ia.service');

async function generateCode(bdd) {
  const prompt = `Gere código Cypress baseado em:\n${bdd}`;
  return await runIA(prompt);
}

module.exports = { generateCode };