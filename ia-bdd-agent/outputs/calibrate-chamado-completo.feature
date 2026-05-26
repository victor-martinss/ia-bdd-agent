# Cenários QA: 2 do Dev — ordem por risco/criticidade
# Foco: Worklist - Inconsistência na associação de registros | Áreas: worklist, portal, protocolo, cpf, compar, integracao | Defeito: Novo protocolo criado sem associação.

Funcionalidade: Worklist — Inconsistência na associação de registros

Cenário: Worklist — Inconsistência na associação de registros — defeito observado
  Dado que o usuário acessa o ambiente Worklist e Portal Web (Mobilemed)
  Quando o usuário cadastra paciente na Worklist com CPF e ano. Enviar exame para o
  Então novo protocolo criado sem associação
    Mas o esperado era: associar corretamente o paciente existente

Cenário: Associar paciente existente no portal
  Dado que o usuário acessa o ambiente Worklist e Portal Web (Mobilemed)
  Quando envio o exame para o portal
  Então o protocolo existente é reutilizado

Cenário: Comparar protocolo worklist x portal
  Dado que o usuário acessa o ambiente Worklist e Portal Web (Mobilemed)
  Quando abro o mesmo paciente nos dois sistemas
  Então o número de protocolo é o mesmo
