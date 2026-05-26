Funcionalidade: Worklist - Falha no envio de exames via Worklist na versão 2.8.3

Cenário: Worklist - Falha no envio de exames via Worklist na versão 2.8.3 — validação principal
  Dado que o sistema está em operação
    E a conexão devidamente estabelecida e com as configurações corretas. Ao realizar
  Quando executa o fluxo principal do chamado
  Então os exames cadastrados manualmente devem ser enviados e recebidos corretamente pelo equipamento

Cenário: Worklist - Falha no envio de exames via Worklist na versão 2.8.3 — comportamento observado (defeito)
  Dado que o cenário principal foi executado
  Quando o fluxo é concluído
  Então o sistema apresenta o defeito: na versão 2
    Mas o esperado era: os exames cadastrados manualmente devem ser enviados e recebidos corretamente pelo equipamento