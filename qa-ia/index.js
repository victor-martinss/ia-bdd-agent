require('./load-env');

const { runBitrixBddCycle } = require('./src/orchestrator/run-bitrix-bdd-cycle');

async function main() {
  console.log('ENV:', process.env.BITRIX_WEBHOOK);
  console.log('🔄 Buscando tarefas do Bitrix...');

  await runBitrixBddCycle(__dirname);
}

main().catch(console.error);
