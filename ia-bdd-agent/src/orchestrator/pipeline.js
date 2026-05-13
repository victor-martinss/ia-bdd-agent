require("../../load-env");
const OpenAI = require("openai");

/**
 * =========================================================
 * OPENAI
 * =========================================================
 */
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * =========================================================
 * HELPERS
 * =========================================================
 */
function texto(valor) {
  if (!valor) return "";
  return String(valor).trim();
}

/**
 * =========================================================
 * EXTRAI DADOS
 * =========================================================
 */
function extrairDadosTask(task) {
  return {
    titulo:
      texto(task.ufCrm94NgfTitulo) ||
      texto(task.title) ||
      "Sem título",

    descricao:
      texto(task.ufCrm94NgfDescricaoDoOcorrido),

    passos:
      texto(task.ufCrm94NgfPassosParaReproduzir),

    resultadoEsperado:
      texto(task.ufCrm94NgfResultadoEsperado),

    resultadoObtido:
      texto(task.ufCrm94NgfResultadoObtido),
  };
}

/**
 * =========================================================
 * GERA BDD
 * =========================================================
 */
async function gerarBDD(task) {
  try {
    console.log("TASK RECEBIDA:");
    console.log(task);

    const dados = extrairDadosTask(task);

    console.log("DADOS EXTRAIDOS:");
    console.log(dados);

    /**
     * Validação
     */
    if (!dados.descricao) {
      return "# Não foi possível gerar BDD (sem descrição)\n";
    }

    /**
     * Prompt
     */
    const prompt = `
Você é um especialista em QA e escrita de cenários BDD.

Gere cenários BDD completos em Gherkin.

DADOS DO CHAMADO

Título:
${dados.titulo}

Descrição do ocorrido:
${dados.descricao}

Passos para reproduzir:
${dados.passos}

Resultado esperado:
${dados.resultadoEsperado}

Resultado obtido:
${dados.resultadoObtido}

REGRAS:
- Responda SOMENTE com o BDD
- Utilize Given / When / Then
- Utilize And quando necessário
- Gere cenários completos
- Utilize português
- Seja técnico e objetivo
`;

    /**
     * OPENAI
     */
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",

      messages: [
        {
          role: "system",
          content:
            "Você é um especialista em QA e automação de testes BDD.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],

      temperature: 0.2,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("ERRO AO GERAR BDD:");
    console.error(error);

    return `
# Erro ao gerar BDD

${error.message}
`;
  }
}

/**
 * =========================================================
 * PROCESSA TASKS
 * =========================================================
 */
async function processarTasks(tasks) {
  for (const task of tasks) {
    console.log(`
==================================================
TASK: ${task.id} - ${task.title}
==================================================
`);

    try {
      /**
       * IMPORTANTE:
       * await obrigatório
       */
      const bdd = await gerarBDD(task);

      console.log(`
================ BDD GERADO ================
`);

      console.log(bdd);
    } catch (err) {
      console.error("ERRO NO PROCESSAMENTO:");
      console.error(err);
    }
  }
}

/**
 * =========================================================
 * MOCK
 * =========================================================
 */
const tasks = [
  {
    id: 352,

    title:
      "Worklist - Inconsistência na associação de registros e divergência de dados (CPF e ano)",

    ufCrm94NgfTitulo:
      "Inconsistência na associação de registros e divergência de dados (CPF e ano)",

    ufCrm94NgfDescricaoDoOcorrido:
      "Mesmo com o CPF do paciente enviado corretamente pela Worklist, o portal gera um novo protocolo ao invés de vincular ao registro existente.",

    ufCrm94NgfPassosParaReproduzir:
      "Cadastrar paciente na Worklist com CPF e ano. Enviar exame para o portal. Verificar geração de novo protocolo.",

    ufCrm94NgfResultadoEsperado:
      "O sistema deve associar corretamente o paciente existente.",

    ufCrm94NgfResultadoObtido:
      "Novo protocolo criado sem associação.",
  },
];

/**
 * =========================================================
 * START
 * =========================================================
 */
(async () => {
  await processarTasks(tasks);
})();