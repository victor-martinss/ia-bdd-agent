# Cenários QA: 0 do Dev + 1 cobertura — ordem por risco/criticidade
# Foco: Relatório PDF vazio | Defeito: PDF com uma página em branco. | Histórico QA: retorno/reprovação — priorizar regressão do defeito
# Redundantes removidos: Relatório PDF vazio — validação principal; Lacuna — resultado esperado

Funcionalidade: Relatório PDF vazio

Cenário: Relatório PDF vazio — defeito observado
  Dado que o usuário acessa o ambiente Relatório PDF vazio
  Quando filtrar período com dados. Exportar PDF. Abrir arquivo
    E cliente exporta relatório filtrado e recebe PDF em branco
  Então pDF com uma página em branco
    Mas o esperado era: pDF contém linhas da grade

Cenário: Relatório PDF vazio — validação principal
  Dado que o usuário acessa o ambiente Relatório PDF vazio
  Quando filtrar período com dados. Exportar PDF. Abrir arquivo
    E cliente exporta relatório filtrado e recebe PDF em branco
  Então pDF contém linhas da grade

Cenário: Cobertura — interrupção do fluxo
  Dado que o usuário acessa o ambiente Relatório PDF vazio
  Quando o usuário inicia a ação principal do chamado
    E interromper ou sair sem concluir a operação
  Então não apresenta erro indevido nem perda inconsistente de dados
