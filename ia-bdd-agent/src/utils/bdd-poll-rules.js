/** Flags de regra do poll (sem dependências de serviços Bitrix). */

function pollOnlyNovoTesteEnabled() {
  if (process.env.BITRIX_POLL_ONLY_NOVO_TESTE === '0') return false;
  return true;
}

function linkedQaMustBeEmptyEnabled() {
  if (process.env.BITRIX_REQUIRE_LINKED_QA_EMPTY === '0') return false;
  return true;
}

/** Card pai (URL no UF) deve estar em "Teste de Q.A." */
function parentMustBeTesteQaEnabled() {
  if (process.env.BITRIX_REQUIRE_PARENT_TESTE_QA === '0') return false;
  return true;
}

module.exports = {
  pollOnlyNovoTesteEnabled,
  linkedQaMustBeEmptyEnabled,
  parentMustBeTesteQaEnabled,
};
