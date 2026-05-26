# Cenários QA: 1 do Dev — ordem por risco/criticidade
# Foco: Worklist - Falha no envio de exames via Worklist na versão 2.8.3 | Áreas: worklist, defeito | Defeito: Exame permanece pendente sem confirmação de recebimento.

Funcionalidade: Worklist — Falha no envio de exames via Worklist na versão 2.8.3

Cenário: Worklist — Falha no envio de exames via Worklist na versão 2.8.3 — defeito observado
  Dado que o usuário acessa o ambiente Worklist
  Quando conectar worklist ao equipamento. Cadastrar exame manualmente. Aguardar envio
    E exames cadastrados manualmente na Worklist não são recebidos pelo equipamento na versão
  Então exame permanece pendente sem confirmação de recebimento
    Mas o esperado era: exames devem ser enviados e recebidos corretamente pelo equipamento

Cenário: Envio manual com conexão ativa
  Dado que o usuário acessa o ambiente Worklist
  Quando cadastro exame manualmente
  Então equipamento recebe o exame
