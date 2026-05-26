Funcionalidade: Melhorar o input do annotation e padronizar entre as builds no DICOM Viewer Web

Cenário: Verificar input de annotation no DICOM Viewer Web
  Dado que o usuário acessa o ambiente DICOM Viewer Web
  Quando o usuário abre um estudo, depois seleciona uma série
    E o usuário utiliza a ferramenta de annotation, depois o formato do input é padronizado
    E nenhuma mensagem de erro é exibida
  Então o layout do input de annotation é exibido corretamente

Cenário: Validar comportamento do espelhamento no DICOM Viewer Web
  Dado que o usuário acessa o ambiente DICOM Viewer Web
  Quando o usuário abre um estudo, depois seleciona uma série
    E o usuário ativa a ferramenta de espelhamento, depois a ordem das imagens permanece inalterada
    E nenhuma mensagem de erro é exibida
  Então as imagens são espelhadas corretamente

Cenário: Conferir resultado da IA sobre imagens no DICOM Viewer Web
  Dado que o usuário acessa o ambiente DICOM Viewer Web
  Quando o usuário abre um estudo, depois seleciona uma série
    E o usuário verifica o resultado exibido na tela
    E nenhuma mensagem de erro é exibida
  Então o resultado da IA é exibido corretamente