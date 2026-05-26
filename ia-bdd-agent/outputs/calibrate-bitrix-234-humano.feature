Funcionalidade: Portable - Interno: Portable - Mensagem de erro ao sair do laudário

Cenário: Portable - Interno: Portable - Mensagem de erro ao sair do laudário — validação principal
  Dado que o sistema está em operação
    E 1 - Abrir Laudário e sair sem iniciar gravação 2 - Iniciar gravação/reprodução e sair do Laudário 3 - Alternar rapidamente entre Laudário e listagem 4 - Validar ausência de erro no log e na UI 5 - Testar múltiplas
  Quando o usuário acessa o Portable > Abrir o laudário de um exame > Sair da tela do laudário (fechando ou alternando para a listagem de exames)
  Então ao sair da tela do laudário, nenhuma mensagem de erro deve ser exibida

Cenário: Portable - Interno: Portable - Mensagem de erro ao sair do laudário — comportamento observado (defeito)
  Dado que o cenário principal foi executado
  Quando o fluxo é concluído
  Então o sistema apresenta: ao sair da tela do laudário, é exibida a mensagem de erro: “PlayStop: Falha ao reproduzir/pausar Exception: Queue empty”
    Mas o esperado era: ao sair da tela do laudário, nenhuma mensagem de erro deve ser exibida