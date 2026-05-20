const path = require('path');
const { getTasks, getTaskDetail } = require('../services/bitrix.service');
const {
  pushBddToCrmCenariosQa,
  classifyBddQaItemActionAsync,
} = require('../services/push-bdd-to-crm');
const { pushBddToLinkedBitrixTasks } = require('../services/push-bdd-to-linked-tasks');
const { pushBddToQaLinkedCrmItems } = require('../services/push-bdd-to-qa-linked-crm');
const { isQaStageId, isDevStageId } = require('../services/crm-qa-stages');
const { getEntityTypeId } = require('../services/bitrix.service');
const { generateBDD } = require('../agents/bdd.agent');
const { initAggregateFile, writeBddArtifacts } = require('../utils/bdd-output');

/**
 * Busca detalhes, gera BDD e grava arquivos (mesmo fluxo do index.js).
 * @param {string} packageRoot __dirname do pacote ia-bdd-agent
 * @param {{ tasks?: object[] | null, quiet?: boolean }} [options]
 * @returns {Promise<{ processed: number, aggregatePath: string | null, taskIds: (string|number)[], crm: { ok: number, skipped: number, failed: number }, linkedTasks: { updated: number, failed: number } }>}
 */
async function runBitrixBddCycle(packageRoot, options = {}) {
  const { tasks: tasksInput = null, quiet = false } = options;

  const tasks = tasksInput != null ? tasksInput : await getTasks();

  if (!tasks.length) {
    if (!quiet) console.log('Nenhuma tarefa encontrada.');
    return {
      processed: 0,
      aggregatePath: null,
      taskIds: [],
      crm: { ok: 0, skipped: 0, failed: 0 },
      linkedTasks: { updated: 0, failed: 0 },
    };
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
  const crm = { ok: 0, skipped: 0, failed: 0 };
  const linkedTasks = { updated: 0, failed: 0 };
  for (const task of tasks) {
    try {
      const itemEtId = task._entityTypeId;
      const detail =
        task._prefetchedDetail ||
        (await getTaskDetail(task.id, {
          entityTypeId: itemEtId,
        }));
      if (itemEtId && detail && !detail._entityTypeId) {
        detail._entityTypeId = itemEtId;
      }
      const classification =
        task._classification || (await classifyBddQaItemActionAsync(detail));

      if (
        classification.action === 'skip_filled' ||
        classification.action === 'skip_qa_history'
      ) {
        if (!quiet) {
          console.log('\n==============================');
          console.log(`TASK: ${task.id} - ${task.title}`);
          console.log('==============================');
          console.log(`[CRM] ${classification.reason}`);
          if (classification.fieldKey) {
            console.log(`      Campo: ${classification.fieldKey}`);
          }
          console.log('');
        }
        crm.skipped += 1;
        continue;
      }

      if (!quiet && classification.action === 'merge') {
        console.log(
          `\n[CRM] Item ${task.id}: ${classification.reason}`
        );
      }

      const bdd = await generateBDD(task.title, detail);

      if (process.env.DEBUG_BITRIX === '1') {
        console.log('DETAIL:', JSON.stringify(detail, null, 2));
      }

      if (!quiet) {
        console.log('\n==============================');
        const pipe =
          task._pipelineName && String(task._pipelineName).trim()
            ? ` [${task._pipelineName}]`
            : itemEtId
              ? ` [SPA ${itemEtId}]`
              : '';
        console.log(`TASK: ${task.id} - ${task.title}${pipe}`);
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

      const etId = itemEtId || (await getEntityTypeId());
      const stageId = detail && (detail.stageId || detail.STAGE_ID);
      const inQa = stageId ? await isQaStageId(String(stageId), etId) : true;
      const inDev = stageId ? await isDevStageId(String(stageId), etId) : false;

      if (inQa || process.env.BITRIX_PUSH_BDD_ON_DEV_CARD === '1') {
        const crmResult = await pushBddToCrmCenariosQa(task.id, bdd, {
          quiet,
          detail,
          entityTypeId: etId,
        });
        if (crmResult.ok) crm.ok += 1;
        else if (crmResult.skipped) crm.skipped += 1;
        else crm.failed += 1;
      } else if (!quiet && inDev) {
        console.log(
          `[CRM] item ${task.id}: coluna de desenvolvimento — cenários não gravados neste card (apenas em cards QA / BITRIX_UF_BDD_FIELD).`
        );
        crm.skipped += 1;
      }

      const qaLinkResult = await pushBddToQaLinkedCrmItems(task.id, bdd, {
        quiet,
        detail,
      });
      linkedTasks.updated += qaLinkResult.updated || 0;
      if (qaLinkResult.failed) linkedTasks.failed += qaLinkResult.failed;
      if (!quiet) {
        if (qaLinkResult.updated) {
          console.log(
            `📎 Cards QA vinculados: ${qaLinkResult.updated} gravado(s) — IDs ${(qaLinkResult.itemIds || []).join(', ')}`
          );
        }
        const skipL = qaLinkResult.skippedAlreadyFilled || 0;
        if (skipL && !qaLinkResult.updated) {
          console.log(
            `📎 Cards QA vinculados: ${skipL} com cenários já preenchidos (ignorados).`
          );
        }
        if (skipL && qaLinkResult.updated) {
          console.log(
            `📎 Cards QA (${skipL} já preenchidos, ignorados; ${qaLinkResult.updated} gravados)`
          );
        }
        if (!qaLinkResult.updated && qaLinkResult.skipped && qaLinkResult.reason && !skipL) {
          console.log(`📎 Cards QA vinculados: ${qaLinkResult.reason}`);
        }
      }

      const linkResult = await pushBddToLinkedBitrixTasks(task.id, bdd, {
        quiet,
        detail,
      });
      linkedTasks.updated += linkResult.updated || 0;
      linkedTasks.failed += linkResult.failed || 0;
      if (!quiet) {
        if (linkResult.skipped) {
          console.log(
            `📎 Tarefas Bitrix: ${linkResult.reason || 'nenhuma atualização'} (IDs tentados: ${(linkResult.taskIds || []).join(', ') || '—'})`
          );
        } else if (linkResult.updated) {
          console.log(
            `📎 Tarefas Bitrix: ${linkResult.updated} gravada(s) — IDs ${(linkResult.taskIds || []).join(', ')}`
          );
        }
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

  if (!quiet && (crm.ok || crm.skipped || crm.failed)) {
    console.log(
      `\n📌 CRM (BDD / Teste Q.A.): ${crm.ok} gravado(s), ${crm.skipped} ignorado(s), ${crm.failed} falha(s)`
    );
  }

  if (!quiet && (linkedTasks.updated || linkedTasks.failed)) {
    console.log(
      `📎 Tarefas Bitrix atreladas: ${linkedTasks.updated} campo(s) gravado(s), ${linkedTasks.failed} falha(s) em tarefas`
    );
  }

  return {
    processed,
    aggregatePath,
    taskIds: tasks.map((t) => t.id),
    crm,
    linkedTasks,
  };
}

module.exports = { runBitrixBddCycle };
