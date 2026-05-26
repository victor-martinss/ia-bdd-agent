# Cenários QA: 0 do Dev + 1 cobertura — ordem por risco/criticidade
# Foco: Checkout — cupom inválido | Áreas: valid | Defeito: Nada acontece; valor permanece sem desconto e sem feedback.
# Redundantes removidos: cupom inválido — validação principal

Funcionalidade: Checkout — cupom inválido

Cenário: Checkout — cupom inválido — defeito observado
  Dado que o usuário acessa o ambiente Checkout
  Quando adicionar produto. Abrir resumo. Informar cupom expirado. Clicar em aplicar
    E ao informar cupom expirado, o carrinho não exibe mensagem de erro
  Então nada acontece; valor permanece sem desconto e sem feedback
    Mas o esperado era: mensagem informando que o cupom é inválido ou expirado

Cenário: Checkout — cupom inválido — validação principal
  Dado que o usuário acessa o ambiente Checkout
  Quando adicionar produto. Abrir resumo. Informar cupom expirado. Clicar em aplicar
    E ao informar cupom expirado, o carrinho não exibe mensagem de erro
  Então mensagem informando que o cupom é inválido ou expirado

Cenário: Cobertura — validação com dado inválido
  Dado que o usuário acessa o ambiente Checkout
  Quando o usuário inicia o fluxo principal do chamado
    E o usuário informa dado inválido ou deixar campo obrigatório vazio
    E o usuário confirma ou salvar
  Então uma mensagem de validação é exibida e o fluxo não conclui incorretamente
