Funcionalidade: Portable - Ação indevida ao clicar múltiplas vezes sem seleção de exame

Cenário: Portable - Ação indevida ao clicar múltiplas vezes sem seleção de exame — validação principal
  Dado que o sistema está em operação
    E o usuário realiza duplo clique em área vazia da listagem
    E o usuário tenta abrir laudo sem selecionar exame por ação explícita
    E o usuário seleciona exame válido e abrir por duplo clique
    E o usuário valida que a mensagem exibida seja adequada ao contexto
  Quando o usuário acessa o Portable em ambiente de homologação
    E ao abrir a tela de listagem de exames
    E não selecionar nenhum exame
    E o usuário clica rapidamente múltiplas vezes na área da listagem (duplo clique ou mais) (no campo
    E observar o comportamento do sistema
  Então nenhuma ação deve ser executada sem que um exame esteja selecionado

Cenário: Portable - Ação indevida ao clicar múltiplas vezes sem seleção de exame — comportamento observado (defeito)
  Dado que o cenário principal foi executado
  Quando o fluxo é concluído
  Então o sistema apresenta o defeito: o sistema tenta executar a ação de abertura de laudo mesmo sem
    Mas o esperado era: nenhuma ação deve ser executada sem que um exame esteja selecionado