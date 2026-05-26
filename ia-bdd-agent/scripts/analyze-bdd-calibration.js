/**
 * Calibra dedup, extras e lacunas contra fixtures + amostra do Bitrix (cenários QA humanos).
 *
 * Uso: node scripts/analyze-bdd-calibration.js [--bitrix=8] [--save]
 */
const path = require('path');
const fs = require('fs');
require(path.join(__dirname, '../load-env'));

const { generateBDD, prepararCtxBdd } = require('../src/agents/bdd.agent');
const { parseFeatureEmCenarios, similaridade } = require('../src/utils/bdd-scenario-planner');
const { flattenItem } = require('../src/agents/parser');
const { getTasks, getTaskDetail } = require('../src/services/bitrix.service');
const { discoverCenariosQaFieldKeys } = require('../src/services/push-bdd-to-crm');

const ROOT = path.join(__dirname, '..');
const FIXTURES = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'fixtures', 'bdd-scenarios.json'), 'utf8')
);

function parseArgs() {
  const bitrixArg = process.argv.find((a) => /^--bitrix(=\d+)?$/i.test(a));
  const bitrixN = bitrixArg
    ? Number.parseInt(bitrixArg.split('=')[1] || '6', 10)
    : Number.parseInt(process.env.BDD_CALIBRATE_BITRIX_N || '6', 10);
  return {
    bitrixSample: Number.isFinite(bitrixN) ? Math.min(bitrixN, 15) : 6,
    save: process.argv.includes('--save'),
  };
}

function analisarFeature(feature, label) {
  const { cenarios } = parseFeatureEmCenarios(feature);
  const titulos = cenarios.map((c) => c.titulo);
  const tipos = {
    dev: 0,
    cobertura: 0,
    lacuna: 0,
    defeito: 0,
    outro: 0,
  };
  for (const t of titulos) {
    const l = t.toLowerCase();
    if (/lacuna\s*—/.test(l)) tipos.lacuna += 1;
    else if (/cobertura\s*—/.test(l)) tipos.cobertura += 1;
    else if (/defeito|reprodu/.test(l)) tipos.defeito += 1;
    else if (/continuação/.test(l)) tipos.outro += 1;
    else tipos.dev += 1;
  }

  let paresSimilares = 0;
  for (let i = 0; i < cenarios.length; i++) {
    for (let j = i + 1; j < cenarios.length; j++) {
      const sim =
        similaridade(cenarios[i].titulo, cenarios[j].titulo) >= 0.65 ||
        similaridade(cenarios[i].texto, cenarios[j].texto) >= 0.72;
      if (sim) paresSimilares += 1;
    }
  }

  const entaoGenerico = cenarios.filter((c) =>
    /comportamento esperado é observado|corresponde ao critério de aceite|sem erro de sistema$/i.test(
      c.texto
    )
  ).length;

  return {
    label,
    total: cenarios.length,
    tipos,
    paresSimilares,
    entaoGenerico,
    titulos,
  };
}

function qaHumanoFromItem(item) {
  const flat = flattenItem(item);
  const keys = discoverCenariosQaFieldKeys(flat);
  for (const k of keys) {
    const v = flat[k];
    if (v && String(v).trim().length > 80 && /cenário|funcionalidade/i.test(String(v))) {
      return { field: k, text: String(v).trim() };
    }
  }
  for (const k of Object.keys(flat)) {
    if (!/cenario.*qa|qa.*cenario/i.test(k)) continue;
    const v = flat[k];
    if (v && String(v).trim().length > 80) {
      return { field: k, text: String(v).trim() };
    }
  }
  return null;
}

async function amostraBitrixComQaHumano(limit) {
  if (!process.env.BITRIX_WEBHOOK) return [];

  const out = [];
  let tasks = [];
  try {
    tasks = await getTasks();
  } catch (e) {
    console.warn('[calibração] Bitrix fila:', e.message || e);
    return [];
  }

  for (const t of tasks) {
    if (out.length >= limit) break;
    try {
      const detail = await getTaskDetail(t.id, { entityTypeId: t._entityTypeId });
      const qa = qaHumanoFromItem(detail);
      if (!qa) continue;
      out.push({
        id: t.id,
        entityTypeId: t._entityTypeId,
        title: t.title || detail.title,
        qaHumano: qa.text,
        item: detail,
        metricHumano: analisarFeature(qa.text, `CRM #${t.id} (QA humano)`),
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

async function rodarFixture(s) {
  const title = s.cardTitle || s.item.title;
  const ctx = await prepararCtxBdd(title, s.item);
  const bdd = await generateBDD(title, s.item);
  return {
    id: s.id,
    name: s.name,
    metric: analisarFeature(bdd, s.id),
    bdd,
  };
}

function media(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function recomendar(metricasFixtures, metricasHumanos) {
  const avgTotal = media(metricasFixtures.map((m) => m.total));
  const avgCobertura = media(metricasFixtures.map((m) => m.tipos.cobertura));
  const avgLacuna = media(metricasFixtures.map((m) => m.tipos.lacuna));
  const avgSimilar = media(metricasFixtures.map((m) => m.paresSimilares));
  const avgGenerico = media(metricasFixtures.map((m) => m.entaoGenerico));

  const humanoAvg =
    metricasHumanos.length > 0
      ? media(metricasHumanos.map((m) => m.total))
      : null;

  const rec = {
    BDD_COVERAGE_MAX_EXTRA: avgCobertura > 2 ? '2' : '2',
    BDD_GAP_MAX: avgLacuna > 2 ? '1' : '2',
    BDD_DEDUP_SIMILARITY: avgSimilar > 0.5 ? '0.68' : '0.72',
  };

  if (avgTotal > 6) rec.BDD_COVERAGE_MAX_EXTRA = '1';
  if (humanoAvg != null && humanoAvg <= 4) rec.BDD_COVERAGE_MAX_EXTRA = '1';
  if (avgGenerico > 1) rec.BDD_COVERAGE_MAX_EXTRA = String(
    Math.max(1, Number.parseInt(rec.BDD_COVERAGE_MAX_EXTRA, 10) - 1)
  );

  return { avgTotal, avgCobertura, avgLacuna, avgSimilar, avgGenerico, humanoAvg, rec };
}

async function main() {
  const { bitrixSample, save } = parseArgs();
  console.log('=== Calibração BDD (fixtures + Bitrix) ===\n');

  const resultadosFixtures = [];
  for (const s of FIXTURES.scenarios || []) {
    process.stdout.write(`Fixture ${s.id}… `);
    try {
      const r = await rodarFixture(s);
      resultadosFixtures.push(r.metric);
      console.log(`${r.metric.total} cen. (cob=${r.metric.tipos.cobertura} lac=${r.metric.tipos.lacuna})`);
      if (save) {
        fs.writeFileSync(
          path.join(ROOT, 'outputs', `calibrate-${s.id}.feature`),
          r.bdd,
          'utf8'
        );
      }
    } catch (e) {
      console.log(`ERRO: ${e.message}`);
    }
  }

  console.log(`\nBuscando até ${bitrixSample} card(s) com cenários QA humanos no Bitrix…`);
  const bitrix = await amostraBitrixComQaHumano(bitrixSample);
  const metricasHumanos = bitrix.map((b) => b.metricHumano);

  for (const b of bitrix) {
    console.log(
      `  #${b.id} "${(b.title || '').slice(0, 50)}" → ${b.metricHumano.total} cenários (humano)`
    );
    if (save) {
      fs.writeFileSync(
        path.join(ROOT, 'outputs', `calibrate-bitrix-${b.id}-humano.feature`),
        b.qaHumano,
        'utf8'
      );
    }
  }

  const { rec, avgTotal, humanoAvg } = recomendar(resultadosFixtures, metricasHumanos);

  console.log('\n--- Métricas fixtures (gerado) ---');
  console.log(`Média cenários: ${avgTotal.toFixed(1)}`);
  console.log(
    `Cobertura/lacuna/similares/genéricos: ${media(resultadosFixtures.map((m) => m.tipos.cobertura)).toFixed(1)} / ${media(resultadosFixtures.map((m) => m.tipos.lacuna)).toFixed(1)} / ${media(resultadosFixtures.map((m) => m.paresSimilares)).toFixed(1)} / ${media(resultadosFixtures.map((m) => m.entaoGenerico)).toFixed(1)}`
  );

  if (metricasHumanos.length) {
    console.log('\n--- Referência QA humano (Bitrix) ---');
    console.log(`Amostra: ${metricasHumanos.length} card(s), média ${media(metricasHumanos.map((m) => m.total)).toFixed(1)} cenários`);
    console.log(
      `Titulos exemplo: ${bitrix[0]?.metricHumano.titulos.slice(0, 3).join(' | ') || '—'}`
    );
  } else {
    console.log('\n(Nenhum card na fila com cenários QA preenchidos — só fixtures.)');
  }

  console.log('\n--- Recomendação de env ---');
  for (const [k, v] of Object.entries(rec)) {
    console.log(`${k}=${v}`);
  }

  console.log('\nAplicando defaults no código…');
  return rec;
}

main()
  .then((rec) => {
    module.exports = { rec };
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
