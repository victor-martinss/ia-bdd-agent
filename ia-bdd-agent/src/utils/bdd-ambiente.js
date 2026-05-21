/**
 * Detecta o ambiente Mobilemed a partir do título e dos cenários Dev.
 * @typedef {{ id: string, label: string, confianca: 'alta'|'media'|'baixa' }} AmbienteDetectado
 */

const REGRAS_AMBIENTE = [
  {
    id: 'portal_vet',
    label: 'Portal Vet',
    confianca: 'alta',
    test: (t) => /portal\s*vet|veterin[aá]ri[ao]/i.test(t),
  },
  {
    id: 'portal_entregas',
    label: 'Portal de Entregas',
    confianca: 'alta',
    test: (t) => /portal\s*(de\s*)?entregas|\bentregas\b.*\bportal\b/i.test(t),
  },
  {
    id: 'dicom_viewer',
    label: 'DICOM Viewer Web',
    confianca: 'alta',
    test: (t) =>
      /\bdicom\b/i.test(t) &&
      /\b(viewer|visualizador|web|espelhamento|s[eé]rie)\b/i.test(t),
  },
  {
    id: 'portable',
    label: 'Portable (Desktop)',
    confianca: 'alta',
    test: (t) =>
      /\b(portable|desktop|laud[aá]rio|grava[çc][aã]o\s+de\s+[aá]udio)\b/i.test(t) &&
      !/\bdicom\s+viewer\b/i.test(t),
  },
  {
    id: 'worklist',
    label: 'Worklist',
    confianca: 'alta',
    test: (t) => /\bworklist\b/i.test(t) && !/\bportal\s+vet\b/i.test(t),
  },
  {
    id: 'mobile',
    label: 'Aplicativo Mobile',
    confianca: 'alta',
    test: (t) =>
      /\b(app\s+mobile|aplicativo\s+mobile|mobile\s+app|android|ios)\b/i.test(t) &&
      !/\bportal\b/i.test(t),
  },
  {
    id: 'portal_web',
    label: 'Portal Web (Mobilemed)',
    confianca: 'media',
    test: (t) =>
      /\b(portal\s*mobilemed|portal\s*web|portal\s*interno|desenvolvimento\s*web)\b/i.test(
        t
      ) || (/\bportal\b/i.test(t) && /\b(web|navegador|browser)\b/i.test(t)),
  },
  {
    id: 'portal_web',
    label: 'Portal Web (Mobilemed)',
    confianca: 'media',
    test: (t) => /\bportal\b/i.test(t) && !/portal\s*(vet|entregas)/i.test(t),
  },
  {
    id: 'web',
    label: 'Web (navegador)',
    confianca: 'baixa',
    test: (t) => /\b(web|navegador|browser|frontend)\b/i.test(t),
  },
];

/**
 * @param {string} titulo
 * @param {string} cenariosDev
 * @returns {AmbienteDetectado}
 */
function detectAmbiente(titulo, cenariosDev = '') {
  const texto = `${titulo || ''}\n${cenariosDev || ''}`.trim();
  if (!texto) {
    return { id: 'indefinido', label: 'sistema', confianca: 'baixa' };
  }

  if (/\bworklist\b/i.test(texto) && /\bportal\b/i.test(texto)) {
    if (/portal\s*vet/i.test(texto)) {
      return { id: 'integracao', label: 'Worklist e Portal Vet', confianca: 'alta' };
    }
    if (/portal\s*(de\s*)?entregas/i.test(texto)) {
      return { id: 'integracao', label: 'Worklist e Portal de Entregas', confianca: 'alta' };
    }
    return {
      id: 'integracao_wl_portal',
      label: 'Worklist e Portal Web (Mobilemed)',
      confianca: 'alta',
    };
  }

  for (const regra of REGRAS_AMBIENTE) {
    if (regra.test(texto)) {
      return {
        id: regra.id,
        label: regra.label,
        confianca: regra.confianca,
      };
    }
  }

  const mod = String(titulo || '')
    .split(/\s*[-–—]\s*/)[0]
    ?.replace(/^\[?\s*FEATURE\s*\]?\s*/i, '')
    .replace(/^squad\s+[\w.]+\s*-\s*/i, '')
    .trim();

  if (mod && mod.length > 2) {
    return { id: 'modulo_titulo', label: mod.slice(0, 50), confianca: 'baixa' };
  }

  return { id: 'indefinido', label: 'sistema Mobilemed', confianca: 'baixa' };
}

/** Linha Gherkin padrão de acesso ao ambiente. */
function dadoAcessaAmbiente(ambiente) {
  const label = (ambiente && ambiente.label) || 'sistema';
  return `  Dado que o usuário acessa o ambiente ${label}`;
}

function onlyTitleAndDevSources() {
  if (process.env.BDD_ASSERTIVE_MODE !== '0') return false;
  return process.env.BDD_ONLY_TITLE_AND_DEV !== '0';
}

module.exports = {
  detectAmbiente,
  dadoAcessaAmbiente,
  onlyTitleAndDevSources,
  REGRAS_AMBIENTE,
};
