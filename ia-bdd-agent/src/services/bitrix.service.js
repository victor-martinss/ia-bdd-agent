require('../../load-env');
console.log("ENV:", process.env.BITRIX_BASE_URL);
const axios = require('axios');

const BASE_URL = process.env.BITRIX_WEBHOOK;

// 🔎 LISTAR TASKS
async function getTasks() {
  const url = `${BASE_URL}/crm.item.list`;

  const response = await axios.get(url, {
    params: {
      entityTypeId: 1276 // ajuste se necessário
    }
  });

  return response.data.result.items;
}

// 🔎 DETALHE DA TASK
async function getTaskDetail(id) {
  const url = `${BASE_URL}/crm.item.get`;

  const response = await axios.get(url, {
    params: {
      entityTypeId: 1276,
      id: id
    }
  });

  return response.data.result.item;
}

// ✅ EXPORT CORRETO
module.exports = {
  getTasks,
  getTaskDetail
};