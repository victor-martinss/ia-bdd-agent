Funcionalidade: Login de usuário

Cenário: Login com sucesso
Dado que o usuário está na tela de login
Quando informa email válido e senha correta
Então deve ser redirecionado para o dashboard

Cenário: Login com senha incorreta
Dado que o usuário está na tela de login
Quando informa email válido e senha incorreta
Então deve visualizar mensagem de erro "Credenciais inválidas"

Cenário: Login com campos vazios
Dado que o usuário está na tela de login
Quando tenta logar sem preencher os campos
Então deve visualizar mensagens de validação

Cenário: Login com email inválido
Dado que o usuário está na tela de login
Quando informa email inválido
Então deve visualizar mensagem "Email inválido"

Cenário: Senha com menos de 6 caracteres
Dado que o usuário está na tela de login
Quando informa senha menor que 6 caracteres
Então deve visualizar mensagem de erro

Cenário: Tentativas consecutivas inválidas
Dado que o usuário tentou logar 5 vezes sem sucesso
Quando tenta novamente
Então a conta deve ser bloqueada temporariamente