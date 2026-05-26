Funcionalidade: Dicom Viewer Desktop - Exibir as DicomTags dos Meta dados na build do Electron

Cenário: Dicom Viewer Desktop - Exibir as DicomTags dos Meta dados na build do Electron — validação principal
  Dado que o sistema está em operação
    E o cenário do dev prevê: dado que eu abra o viewer e entao eu abra um exame , devo conseguir ver os meta dados do exame( dicom tag) ao abrir o modal de dicomtags pelo respectivo icone na barra superior
  Quando o usuário executa o fluxo principal do chamado
  Então o comportamento deve estar alinhado à regra de negócio do chamado

Cenário: Dicom Viewer Desktop - Exibir as DicomTags dos Meta dados na build do Electron — melhoria sugerida
  Dado que o time analisou o chamado
  Quando a melhoria for implementada: existe no viewer desktop atual , e É muito util para debug e troubleshooting do suporte
  Então o sistema deve atender ao objetivo da melhoria sem regressões no fluxo existente