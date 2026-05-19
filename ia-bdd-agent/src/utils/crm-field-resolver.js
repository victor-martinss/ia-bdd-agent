function texto(valor) {
  if (valor == null || valor === '') return '';
  if (Array.isArray(valor)) return valor.map(texto).filter(Boolean).join(', ');
  return String(valor).trim();
}

function isMeaningful(s) {
  const t = texto(s);
  if (t.length < 3) return false;
  if (/^x+$/i.test(t)) return false;
  if (/^[\-–—.]+$/i.test(t)) return false;
  if (/^n\/?a$/i.test(t)) return false;
  return true;
}

/**
 * Lê o primeiro UF preenchido cujo nome contém algum dos fragmentos (ex.: NgfDescricaoDoOcorrido).
 * @param {Record<string, unknown>} item
 * @param {string[]} nameFragments
 */
function pickCrmUfText(item, nameFragments) {
  if (!item || typeof item !== 'object') return '';

  const frags = nameFragments.map((f) => f.toLowerCase());

  const prefixes = ['ufCrm94', 'ufCrm100'];
  for (const p of prefixes) {
    for (const frag of frags) {
      const exact = `${p}${frag}`;
      if (Object.prototype.hasOwnProperty.call(item, exact) && isMeaningful(item[exact])) {
        return texto(item[exact]);
      }
    }
  }

  for (const k of Object.keys(item)) {
    if (!/^ufCrm\d+/i.test(k)) continue;
    const lower = k.toLowerCase();
    if (frags.some((f) => lower.includes(f.toLowerCase())) && isMeaningful(item[k])) {
      return texto(item[k]);
    }
  }
  return '';
}

module.exports = { pickCrmUfText, texto };
