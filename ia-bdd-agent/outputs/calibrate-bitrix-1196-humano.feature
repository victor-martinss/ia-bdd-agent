Funcionalidade: Sincronização de protocolo entre Worklist e Portal

Cenário: Verificar sincronização de protocolo do exame entre Worklist e Portal
  Dado que o usuário acessa o ambiente Worklist
    E o usuário anota o protocolo do exame "123456" na Worklist
  Dado que o usuário acessa o ambiente Portal Web (Mobilemed)
    E o usuário pesquisa o paciente com CPF "123.456.789-00
    E o usuário abre o exame correspondente
  Quando o usuário executa o fluxo descrito no chamado
  Então o protocolo exibido no Portal é igual ao da Worklist

Cenário: Verificar ausência de mensagens de erro ao enviar exame do Worklist para o Portal
  Dado que o usuário acessa o ambiente Worklist
    E o usuário seleciona o exame "123456
    E o usuário envia o exame para o Portal
  Dado que o usuário acessa o ambiente Portal Web (Mobilemed)
    E o usuário pesquisa o paciente com CPF "123.456.789-00
  Quando o usuário executa o fluxo descrito no chamado
  Então nenhuma mensagem de erro é exibida

Cenário: Verificar visibilidade do exame na Worklist após envio ao Portal
  Dado que o usuário acessa o ambiente Worklist
    E o usuário seleciona o exame "123456
    E o usuário envia o exame para o Portal
    E o usuário aguarda 5 minutos
  Quando o usuário executa o fluxo descrito no chamado
  Então o exame permanece visível na Worklist após 5 minutos

Cenário: Verificar consistência de dados do paciente entre Worklist e Portal
  Dado que o usuário acessa o ambiente Worklist
    E o usuário anota o CPF do paciente "123.456.789-00
  Dado que o usuário acessa o ambiente Portal Web (Mobilemed)
    E o usuário pesquisa o paciente com CPF "123.456.789-00
  Quando o usuário executa o fluxo descrito no chamado
  Então o nome do paciente exibido no Portal é igual ao da Worklist