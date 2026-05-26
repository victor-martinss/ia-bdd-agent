# Cenários QA: 2 do Dev + 1 cobertura + 1 lacuna(s) — ordem por risco/criticidade
# Foco: Portable - Interno: Mensagem de erro ao sair do laudário | Áreas: laud, defeito | Defeito: Mensagem PlayStop: Falha ao reproduzir/pausar.
# Redundantes removidos: Sair do laudário sem gravação

Funcionalidade: Portable — Interno: Mensagem de erro ao sair do laudário

Cenário: Portable — Interno: Mensagem de erro ao sair do laudário — defeito observado
  Dado que o usuário acessa o ambiente Portable (Desktop)
  Quando o usuário abre laudário. Iniciar gravação. Sair da tela do laudário
    E ao sair do laudário após gravação, aparece erro PlayStop na UI
  Então mensagem PlayStop: Falha ao reproduzir/pausar
    Mas o esperado era: nenhuma mensagem de erro ao sair do laudário

Cenário: Sair após gravação
  Dado que o usuário acessa o ambiente Portable (Desktop)
  Quando gravo áudio e saio do laudário
  Então não exibe mensagem de erro

Cenário: Cobertura — interrupção do fluxo
  Dado que o usuário acessa o ambiente Portable (Desktop)
  Quando o usuário inicia a ação principal do chamado
    E interromper ou sair sem concluir a operação
  Então não apresenta erro indevido nem perda inconsistente de dados

Cenário: Lacuna — descrição do ocorrido
  Dado que o usuário acessa o ambiente Portable (Desktop)
  Quando o usuário abre laudário. Iniciar gravação. Sair da tela do laudário
  Então ao sair do laudário após gravação, aparece erro PlayStop na UI
