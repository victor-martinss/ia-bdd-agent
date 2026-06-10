const path = require('path');
const { getTasks, getTaskDetail } = require('../services/bitrix.service');
const {
  pushBddToCrmCenariosQa,
  classifyBddQaItemActionAsync,
  bddPodePublicarNoCrm,
} = require('../services/push-bdd-to-crm');
const {
  discoverBddLinkedTargets,
  shouldPushBddToMainCard,
  pushBddToAllLinkedDestinations,
} = require('../utils/bdd-push-routing');
const { resolveCanonicalBddForLinked } = require('../utils/bdd-canonical-for-linked');
const { isQaStageId, isDevStageId } = require('../services/crm-qa-stages');
const { getEntityTypeId } = require('../services/bitrix.service');
const { generateBDD } = require('../agents/bdd.agent');
const { initAggregateFile, writeBddArtifacts } = require('../utils/bdd-output');
const { evaluateBddPollEligibility } = require('../utils/bdd-poll-eligibility');
const {
  diagnoseBddSkipRootCause,
  logBddSkipRootCause,
} = require('../utils/bdd-skip-root-cause');

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
  const crm = { ok: 0, skipped: 0, failed: 0, linkedQa: 0, lastField: null };
  const linkedTasks = { updated: 0, failed: 0 };
  let lastBdd = '';
  let publicavel = false;
  let linkedQaResult = null;
  let eligibility = null;
  let generationError = null;

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

      let bdd;
      try {
        bdd = await generateBDD(task.title, detail);
      } catch (genErr) {
        generationError = genErr.message || String(genErr);
        throw genErr;
      }
      lastBdd = bdd;

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

      const etId =
        itemEtId ||
        (detail && detail._entityTypeId) ||
        (await getEntityTypeId());
      const stageId = detail && (detail.stageId || detail.STAGE_ID);
      const inQa = stageId ? await isQaStageId(String(stageId), etId) : true;
      const inDev = stageId ? await isDevStageId(String(stageId), etId) : false;
      publicavel = bddPodePublicarNoCrm(bdd);
      const veioFilaQa = Boolean(task._queueKey);
      const forcarGravacaoCrm =
        task._forceCrmPush === true ||
        process.env.BITRIX_PUSH_BDD_IGNORE_STAGE === '1';

      eligibility =
        task._pollEligibility ||
        (await evaluateBddPollEligibility(task.id, detail, {
          skipStageCheck: !veioFilaQa || forcarGravacaoCrm,
        }));

      const podeGravarCrm =
        publicavel &&
        (forcarGravacaoCrm || (eligibility && eligibility.proceed !== false));

      if (!publicavel && !quiet) {
        const diag = diagnoseBddSkipRootCause({
          detail,
          bdd,
          classification,
          publicavel: false,
        });
        console.warn(`[CRM] item ${task.id}: cenários não gravados — ${diag.reason}`);
        if (diag.hints?.length) {
          for (const h of diag.hints) {
            console.warn(`      → ${h}`);
          }
        }
      } else if (publicavel && !podeGravarCrm && !quiet) {
        const diag = diagnoseBddSkipRootCause({ eligibility, classification, publicavel: true });
        console.warn(`[CRM] item ${task.id}: cenários não gravados — ${diag.reason}`);
        logBddSkipRootCause(task.id, diag);
      }

      const targets = await discoverBddLinkedTargets(task.id, detail);
      const gravarNoCardPrincipal = shouldPushBddToMainCard(targets);

      if (
        podeGravarCrm &&
        gravarNoCardPrincipal &&
        (inQa || forcarGravacaoCrm || process.env.BITRIX_PUSH_BDD_ON_DEV_CARD === '1')
      ) {
        if (!inQa && forcarGravacaoCrm && !quiet && stageId) {
          console.log(
            `[CRM] item ${task.id}: estágio "${stageId}" — gravando mesmo assim (fila QA / merge / forçado).`
          );
        }
        const crmResult = await pushBddToCrmCenariosQa(task.id, bdd, {
          quiet,
          detail,
          entityTypeId: etId,
        });
        if (crmResult.ok) {
          crm.ok += 1;
          crm.lastField = crmResult.field || crm.lastField;
        } else if (crmResult.skipped) crm.skipped += 1;
        else crm.failed += 1;
      } else if (
        podeGravarCrm &&
        !gravarNoCardPrincipal &&
        targets.hasLinkedDestinations &&
        !quiet
      ) {
        console.log(
          `[CRM] item ${task.id}: BDD nas tarefas/cards atrelados (card principal omitido — BITRIX_BDD_PUSH_TARGET=${process.env.BITRIX_BDD_PUSH_TARGET || 'linked'}).`
        );
        console.log(
          `      Atrelados: ${targets.childCrmIds.length} filho(s) CRM, ${targets.linkedQaCrmIds.length} card(s) QA, ${targets.linkedBitrixTaskIds.length} tarefa(s) Bitrix`
        );
      } else if ((!publicavel || !podeGravarCrm) && (inQa || forcarGravacaoCrm)) {
        crm.skipped += 1;
      } else if (publicavel && !podeGravarCrm && !quiet) {
        crm.skipped += 1;
      } else if (publicavel && !inQa && !inDev && !forcarGravacaoCrm && !quiet) {
        console.warn(
          `[CRM] item ${task.id}: estágio "${stageId || '?'}" não reconhecido como QA (SPA ${etId}) — cenários não gravados. Use: npm run bdd:item -- ${task.id} ${etId}`
        );
        crm.skipped += 1;
      } else if (!quiet && inDev) {
        console.log(
          `[CRM] item ${task.id}: coluna de desenvolvimento — cenários não gravados neste card (apenas em cards QA / BITRIX_UF_BDD_FIELD).`
        );
        crm.skipped += 1;
      }

      const canonical = resolveCanonicalBddForLinked(detail, bdd);
      const bddAtrelados = canonical.bdd;
      if (
        !quiet &&
        targets.hasLinkedDestinations &&
        canonical.source !== 'gerado'
      ) {
        console.log(
          `[CRM] BDD canônico: ${canonical.nCanonical} cenário(s) (${canonical.source}; pai=${canonical.nParent}, gerado=${canonical.nGenerated}) → replicar nos atrelados`
        );
      } else if (!quiet && targets.hasLinkedDestinations && canonical.nCanonical > 0) {
        console.log(
          `[CRM] BDD canônico: ${canonical.nCanonical} cenário(s) → replicar nos atrelados`
        );
      }

      const linkedPush =
        podeGravarCrm && publicavel
          ? await pushBddToAllLinkedDestinations(task.id, bddAtrelados, detail, {
              quiet,
            })
          : {
              qa: {
                skipped: true,
                reason: !publicavel
                  ? 'BDD sem cenários válidos'
                  : eligibility?.reason || 'não elegível para gravar',
                updated: 0,
                skippedAlreadyFilled: 0,
              },
              child: { updated: 0, skipped: true },
              tasks: { updated: 0, skipped: true },
              updated: 0,
              failed: 0,
            };
      const qaLinkResult = linkedPush.qa;
      linkedQaResult = qaLinkResult;
      const childCrmResult = linkedPush.child;
      const linkResult = linkedPush.tasks;
      if (qaLinkResult.updated) {
        crm.linkedQa += qaLinkResult.updated;
        if (!gravarNoCardPrincipal) {
          crm.ok += qaLinkResult.updated;
        }
      }
      if (childCrmResult.updated && !gravarNoCardPrincipal) {
        crm.ok += childCrmResult.updated;
      }
      linkedTasks.updated += linkedPush.updated || 0;
      linkedTasks.failed += linkedPush.failed || 0;

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
        if (childCrmResult.updated) {
          console.log(
            `📎 Itens CRM filhos: ${childCrmResult.updated} gravado(s) — IDs ${(childCrmResult.itemIds || []).join(', ')}`
          );
        } else if (
          childCrmResult.skipped &&
          childCrmResult.reason &&
          childCrmResult.reason !== 'nenhum item CRM filho'
        ) {
          console.log(`📎 Itens CRM filhos: ${childCrmResult.reason}`);
        }
      }

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
      if (publicavel) processed += 1;
    } catch (err) {
      generationError = err.message || String(err);
      console.error(`Erro na task ${task.id}:`, err.message);
      if (!quiet) {
        const diag = diagnoseBddSkipRootCause({
          detail: task._prefetchedDetail,
          error: generationError,
          classification: task._classification,
          eligibility: task._pollEligibility,
        });
        logBddSkipRootCause(task.id, diag);
      }
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
    lastBdd,
    publicavel,
    linkedQaResult,
    eligibility,
    generationError,
  };
}

module.exports = { runBitrixBddCycle };
