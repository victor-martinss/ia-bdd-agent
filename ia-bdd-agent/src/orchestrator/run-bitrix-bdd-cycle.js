const path = require('path');
const { getTasks, getTaskDetail } = require('../services/bitrix.service');
const { generateBDD } = require('../agents/bdd.agent');
const { initAggregateFile, writeBddArtifacts } = require('../utils/bdd-output');

/**
 * Busca detalhes, gera BDD e grava arquivos (mesmo fluxo do index.js).
 * @param {string} packageRoot __dirname do pacote ia-bdd-agent
 * @param {{ tasks?: object[] | null, quiet?: boolean }} [options]
 * @returns {Promise<{ processed: number, aggregatePath: string | null, taskIds: (string|number)[] }>}
 */
async function runBitrixBddCycle(packageRoot, options = {}) {
  const { tasks: tasksInput = null, quiet = false } = options;

  const tasks = tasksInput != null ? tasksInput : await getTasks();

  if (!tasks.length) {
    if (!quiet) console.log('Nenhuma tarefa encontrada.');
    return { processed: 0, aggregatePath: null, taskIds: [] };
  }

  const aggregatePath = initAggregateFile(packageRoot);
  if (!quiet) {
    if (aggregatePath) {
      console.log(`\n📁 BDD gravados em: ${path.dirname(aggregatePath)}`);
      console.log(`📄 Consolidado: ${aggregatePath}\n`);
    } else {
      console.log(
        '\n(BDD_OUTPUT_DIR=0 — saída em arquivo desligada.)\n'
      );
    }
  }

  let processed = 0;
  for (const task of tasks) {
    try {
      const detail = await getTaskDetail(task.id);
      const bdd = await generateBDD(task.title, detail);

      if (process.env.DEBUG_BITRIX === '1') {
        console.log('DETAIL:', JSON.stringify(detail, null, 2));
      }

      if (!quiet) {
        console.log('\n==============================');
        console.log(`TASK: ${task.id} - ${task.title}`);
        console.log('==============================');
      }

      const { file } = writeBddArtifacts(
        packageRoot,
        { taskId: task.id, title: task.title, bdd },
        aggregatePath
      );
      if (!quiet && file) {
        console.log(`📄 BDD completo (arquivo): ${file}\n`);
      }
      if (!quiet) {
        console.log(bdd);
        console.log('');
      }
      processed += 1;
    } catch (err) {
      console.error(`Erro na task ${task.id}:`, err.message);
    }
  }

  if (!quiet && aggregatePath) {
    console.log(`\n✅ Consolidado: ${aggregatePath}`);
  }

  return {
    processed,
    aggregatePath,
    taskIds: tasks.map((t) => t.id),
  };
}

module.exports = { runBitrixBddCycle };
