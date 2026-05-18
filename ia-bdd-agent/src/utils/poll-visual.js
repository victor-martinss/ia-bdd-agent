const { logTimestampBr } = require('./datetime-br');

const useColor = process.env.NO_COLOR !== '1' && process.env.BDD_POLL_NO_COLOR !== '1';

const c = useColor
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      cyan: '\x1b[36m',
      magenta: '\x1b[35m',
      red: '\x1b[31m',
      blue: '\x1b[34m',
      bgGreen: '\x1b[42m\x1b[30m',
      bgYellow: '\x1b[43m\x1b[30m',
      bgMagenta: '\x1b[45m\x1b[37m',
    }
  : {
      reset: '',
      bold: '',
      dim: '',
      green: '',
      yellow: '',
      cyan: '',
      magenta: '',
      red: '',
      blue: '',
      bgGreen: '',
      bgYellow: '',
      bgMagenta: '',
    };

function paint(code, text) {
  return `${code}${text}${c.reset}`;
}

function line(char = '─', width = 58) {
  return char.repeat(width);
}

/**
 * @param {{ id: string|number, title?: string, classification: { action: string, reason?: string, fieldKey?: string|null } }} row
 */
function printNewInQueueAlert(row) {
  const { id, title, classification } = row;
  const titulo = (title || 'sem título').slice(0, 52);
  const ts = logTimestampBr();

  console.log('');
  console.log(paint(c.cyan, line('═')));
  console.log(
    paint(c.bgMagenta + c.bold, ` 🆕 NOVO NA FILA QA `) +
      paint(c.bold, `  ID ${id}  `) +
      paint(c.dim, ts)
  );
  console.log(paint(c.cyan, `   ${titulo}`));

  if (classification.action === 'generate') {
    console.log(
      paint(c.green + c.bold, '   ▶ SEM cenários QA — gerando BDD agora…')
    );
  } else if (classification.action === 'merge') {
    console.log(
      paint(c.yellow + c.bold, '   ▶ Cenários com marcador — atualizando bloco [IA]…')
    );
  } else {
    const fk = classification.fieldKey ? ` (${classification.fieldKey})` : '';
    console.log(
      paint(c.yellow + c.bold, `   ● JÁ PREENCHIDO${fk} — não altera (aprovado/manual)`)
    );
    if (classification.reason) {
      console.log(paint(c.dim, `     ${classification.reason}`));
    }
  }
  console.log(paint(c.cyan, line('═')));
  console.log('');
}

/**
 * @param {{ id: string|number, title?: string }} row
 * @param {{ ok?: boolean, field?: string }} [crmResult]
 */
function printGeneratedSuccess(row, crmResult = {}) {
  const fk = crmResult.field ? ` → ${crmResult.field}` : '';
  console.log(
    paint(
      c.bgGreen + c.bold,
      ` ✓ BDD GRAVADO `
    ) +
      paint(c.green, ` item ${row.id}${fk} `) +
      paint(c.dim, logTimestampBr())
  );
  console.log('');
}

function printGeneratedError(id, message) {
  console.log(
    paint(c.red + c.bold, ` ✗ FALHA item ${id}: `) + paint(c.red, message || 'erro')
  );
  console.log('');
}

function printScanProgress(index, total, id, title) {
  const ts = logTimestampBr();
  const titulo = (title || '').slice(0, 40);
  console.log(
    paint(c.dim, `${ts} `) +
      paint(c.blue, `[${index}/${total}]`) +
      ` Lendo CRM #${id}` +
      (titulo ? paint(c.dim, ` — ${titulo}`) : '')
  );
}

/**
 * @param {object} scan
 * @param {{ newInQueue: (string|number)[], removedFromQueue: (string|number)[] }} delta
 */
function printCycleSummary(scan, delta) {
  const ts = logTimestampBr();
  console.log('');
  console.log(paint(c.bold, `${ts} Resumo da fila QA (${scan.total} itens)`));

  if (delta.newInQueue.length) {
    console.log(
      paint(c.magenta + c.bold, `  🆕 Entraram na fila neste ciclo: ${delta.newInQueue.length}`) +
        paint(c.magenta, ` — IDs ${delta.newInQueue.join(', ')}`)
    );
  }
  if (delta.removedFromQueue.length) {
    console.log(
      paint(c.dim, `  ↪ Saíram da fila: ${delta.removedFromQueue.join(', ')}`)
    );
  }

  console.log(
    paint(c.green, `  ○ Sem cenários (gerar): ${scan.empty.length}`) +
      (scan.empty.length
        ? paint(c.green, ` — ${scan.empty.map((r) => r.id).join(', ')}`)
        : '')
  );
  console.log(
    paint(c.yellow, `  ● Já preenchidos: ${scan.filled.length}`) +
      (scan.filled.length && scan.filled.length <= 8
        ? paint(c.dim, ` — ${scan.filled.map((r) => r.id).join(', ')}`)
        : scan.filled.length > 8
          ? paint(c.dim, ` — ${scan.filled.slice(0, 8).map((r) => r.id).join(', ')}…`)
          : '')
  );
  if (scan.merge.length) {
    console.log(
      paint(c.cyan, `  ◐ Atualizar bloco IA: ${scan.merge.map((r) => r.id).join(', ')}`)
    );
  }
  if (scan.errors.length) {
    console.log(paint(c.red, `  ✕ Erros leitura: ${scan.errors.map((e) => e.id).join(', ')}`));
  }
  console.log('');
}

module.exports = {
  paint,
  printNewInQueueAlert,
  printGeneratedSuccess,
  printGeneratedError,
  printScanProgress,
  printCycleSummary,
};
