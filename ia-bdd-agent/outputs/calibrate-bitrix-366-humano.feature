Funcionalidade: Worklist - Limpeza automática da Worklist não remove exames após período configurado

Cenário: Worklist - Limpeza automática da Worklist não remove exames após período configurado — validação principal
  Dado que o sistema está em operação
    E inf e evidêncas enviadas pela Isabelly NQ
  Quando configurar o tempo de limpeza da Worklist para 1 dia
    E criar e enviar exames ao Portal
    E aguardar período superior a 1 dia
    E o usuário verifica a Worklist
    E confirmar que os exames antigos ainda permanecem disponíveis
  Então os exames devem ser removidos automaticamente da Worklist após o período configurado de retenção (1 dia)

Cenário: Worklist - Limpeza automática da Worklist não remove exames após período configurado — comportamento observado (defeito)
  Dado que o cenário principal foi executado
  Quando o fluxo é concluído
  Então o sistema apresenta: os exames continuam disponíveis na Worklist mesmo após o prazo configurado para exclusão automática
    Mas o esperado era: os exames devem ser removidos automaticamente da Worklist após o período configurado de retenção (1 dia)