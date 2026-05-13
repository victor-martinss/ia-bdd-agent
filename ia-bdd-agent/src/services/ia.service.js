const axios = require('axios');
require('../../load-env');

async function runIA(prompt) {
  const res = await axios.post(process.env.OLLAMA_URL, {
    model: process.env.MODEL,
    prompt,
    stream: false
  });

  return res.data.response;
}

module.exports = { runIA };