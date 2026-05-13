const { runIA } = require('../services/ia.service');

async function reviewQA(input) {
  const prompt = `Avalie qualidade QA:\n${JSON.stringify(input)}`;
  return await runIA(prompt);
}

module.exports = { reviewQA };