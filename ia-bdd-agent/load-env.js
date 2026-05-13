/** Carrega o `.env` desta pasta via `__dirname`, independente do diretório de execução. Ver README.md (seção *Sobre o load-env.js*). */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
