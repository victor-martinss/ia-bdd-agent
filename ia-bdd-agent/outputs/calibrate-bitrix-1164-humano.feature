Funcionalidade: Leitura de séries no Dicom Viewer Web

Cenário: Validação da leitura de múltiplas séries no Mobile Viewer
  Dado que o usuário acessa o Dicom Viewer Web no Mobile Viewer
    E múltiplas séries estão selecionadas
  Quando solicita a leitura das séries
  Então todas as séries selecionadas são lidas corretamente

Cenário: Comportamento observado (defeito) na leitura de séries
  Dado que o usuário acessa o Dicom Viewer Web no Mobile Viewer
    E múltiplas séries estão selecionadas
  Quando solicita a leitura das séries
  Então apenas uma série é lida, não todas as selecionadas