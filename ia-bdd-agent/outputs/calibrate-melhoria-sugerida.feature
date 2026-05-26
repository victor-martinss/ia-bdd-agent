# Cenários QA: 0 do Dev + 1 cobertura + 1 lacuna(s) — ordem por risco/criticidade
# Foco: Portal - Sugestão de UX no fluxo de login | Áreas: portal, valid | Aceite: Mensagem clara indicando credenciais inválidas.
# Redundantes removidos: Sugestão de UX no fluxo de login — validação principal

Funcionalidade: Portal — Sugestão de UX no fluxo de login

Cenário: Portal — Sugestão de UX no fluxo de login — validação principal
  Dado que o usuário acessa o ambiente Portal Web (Mobilemed)
  Quando o usuário acessa login. Informar credenciais inválidas. Observar mensagem
    E usuário não entende quando a senha está incorreta
  Então mensagem clara indicando credenciais inválidas

Cenário: Cobertura — validação com dado inválido
  Dado que o usuário acessa o ambiente Portal Web (Mobilemed)
  Quando o usuário inicia o fluxo principal do chamado
    E o usuário informa dado inválido ou deixar campo obrigatório vazio
    E o usuário confirma ou salvar
  Então uma mensagem de validação é exibida e o fluxo não conclui incorretamente

Cenário: Lacuna — descrição do ocorrido
  Dado que o usuário acessa o ambiente Portal Web (Mobilemed)
  Quando o usuário acessa login. Informar credenciais inválidas. Observar mensagem
  Então usuário não entende quando a senha está incorreta
