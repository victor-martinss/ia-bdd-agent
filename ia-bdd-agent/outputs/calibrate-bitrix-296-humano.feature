CT 01 (APROVADO) — Validar RevisIA habilitada

Dado que a RevisIA está habilitada para unidade e usuário
Quando o médico acessar o laudário no Portable
Então a funcionalidade RevisIA deve ficar disponível.

CT 02 (APROVADO) — Validar acionamento manual da RevisIA

Dado que a RevisIA está habilitada
Quando o médico acionar a revisão no laudário
Então o sistema deve exibir as sugestões de revisão manualmente.

CT 03 (APROVADO) — Validar sugestões separadas do corpo do laudo

Dado que a revisão foi gerada
Quando o sistema apresentar sugestões, correções ou alertas
Então as informações devem ser exibidas separadas do texto do laudo.

CT 04 (APROVADO) — Validar aplicação da revisão somente com confirmação

Dado que a RevisIA exibiu sugestões de revisão
Quando o médico confirmar a aplicação
Então o sistema deve aplicar a revisão no laudário.

CT 05 (APROVADO) — Validar que a revisão não altera o laudo automaticamente

Dado que a RevisIA exibiu sugestões de revisão
Quando o médico não confirmar a aplicação
Então o conteúdo do laudário deve permanecer sem alteração.

CT 06 (APROVADO) — Validar cópia completa da revisão

Dado que a revisão foi gerada
Quando o médico copiar o conteúdo completo
Então o sistema deve copiar o texto sem tags ou caracteres indevidos.

CT 07 (REPROVADO versão antiga e nova) — Validar cópia de trecho selecionado

Dado que a revisão foi gerada
Quando o médico selecionar e copiar apenas um trecho
Então o sistema deve copiar somente o conteúdo selecionado, sem tags ou caracteres indevidos.

CT 08 (APROVADO) — Validar reformulação da revisão

Dado que a RevisIA gerou uma análise do laudo
Quando o médico solicitar a reformulação
Então o sistema deve substituir a análise anterior pela nova revisão, mantendo as sugestões separadas do corpo do laudo.

CT 09 (APROVADO) — Validar estabilidade após múltiplas requisições

Dado que a RevisIA está habilitada
Quando o médico executar a revisão múltiplas vezes na mesma sessão
Então o sistema deve continuar respondendo corretamente, sem modal em branco, caixa cinza ou erro nas próximas tentativas.

CT 10 (APROVADO) — Validar RevisIA desabilitada

Dado que a RevisIA está desabilitada para unidade ou usuário
Quando o médico acessar o laudário no Portable
Então a funcionalidade RevisIA não deve permitir utilização.

CT 11 (APROVADO) — Validar bloqueio da RevisIA desabilitada

Dado que a RevisIA está desabilitada
Quando o médico tentar acionar a revisão no laudário
Então o sistema não deve gerar sugestões de revisão.