Funcionalidade: Portable - [IMPROVE] – Respeitar limite de abas abertas no Portable

Cenário: Portable - [IMPROVE] – Respeitar limite de abas abertas no Portable — validação principal
  Dado que o sistema está em operação
    E o usuário acessa o fluxo "Portable"
  Quando executa o cenário "[IMPROVE] — Respeitar limite de abas abertas no Portable"
  Então o sistema deve concluir o fluxo "[IMPROVE] Respeitar limite de abas abertas no Portable" com sucesso

Cenário: Portable - [IMPROVE] – Respeitar limite de abas abertas no Portable — melhoria sugerida
  Dado que o time analisou o chamado
    E o motivo registrado é: como usuário do Portable, Quero que o sistema respeite o limite de abas abertas, Para garantir que o desempenho e a usabilidade não sejam comprometidos ao ter múltiplas abas abertas ao mesmo tempo, evitando sobrecarga
  Então o sistema deve atender ao objetivo da melhoria sem regressões no fluxo existente