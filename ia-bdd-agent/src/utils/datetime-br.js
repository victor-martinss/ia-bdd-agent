/**
 * Datas/horas nos logs no fuso de Brasília (ou BDD_LOG_TIMEZONE).
 */

function logTimezone() {
  const tz = (process.env.BDD_LOG_TIMEZONE || 'America/Sao_Paulo').trim();
  return tz || 'America/Sao_Paulo';
}

/**
 * @param {Date} [date]
 * @returns {string} ex.: 18/05/2026 14:43:28 (horário de Brasília)
 */
function formatDateTimeBr(date = new Date()) {
  const tz = logTimezone();
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toLocaleString('pt-BR');
  }
}

/** Prefixo padrão para linhas de log do poll. */
function logTimestampBr(date = new Date()) {
  return `[${formatDateTimeBr(date)} BRT]`;
}

module.exports = {
  logTimezone,
  formatDateTimeBr,
  logTimestampBr,
};
