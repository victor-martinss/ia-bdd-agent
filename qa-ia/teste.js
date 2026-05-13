const { getTasks } = require('./src/services/bitrix.service');

getTasks()
  .then((tasks) => {
    console.log("Tarefas:");
    console.log(tasks);
  })
  .catch((err) => {
    console.error("Erro:");
    console.error(err);
  });