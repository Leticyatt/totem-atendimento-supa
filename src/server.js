/**
 * server.js
 * ---------
 * Ponto de entrada do backend do Totem de Atendimento ao Consumidor.
 * Responsabilidade única: conferir a configuração do banco e subir o
 * servidor HTTP na porta configurada. A montagem da aplicação (rotas,
 * middlewares, pilares) fica em ./app.js.
 */

// Captura quedas inesperadas de processo (ex: interrupção abrupta de energia)
process.on('uncaughtException', (err) => {
  console.error('[CRÍTICO] O servidor sofreu uma interrupção abrupta de energia ou falha de sistema:', err);
  // Aqui o log grava a emergência antes do encerramento total do hardware
  process.exit(1);
});

const config = require('../config/config');

if (!config.banco.url) {
  console.error(
    '[ERRO] DATABASE_URL não definida. Copie .env.example para .env e preencha a conexão do banco (veja o README).'
  );
  process.exit(1);
}

const { criarApp } = require('./app');
const { logInfo, logErro } = require('./logger');
const { verificarConexao, verificarPrivilegios } = require('./db');

async function iniciar() {
  // RECURSO 3 - o back-end não pode estar conectado como administrador.
  const { usuario, administrador } = await verificarPrivilegios();
  if (administrador) {
    const msg = `O banco está conectado com o usuário "${usuario}", que tem poder de administrador. Use o usuário restrito totem_app (DATABASE_URL).`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Menor privilégio violado: ${msg}`);
    }
    logInfo(`ATENÇÃO: ${msg}`);
  } else {
    logInfo(`Banco conectado como usuário restrito "${usuario}" (menor privilégio).`);
  }

  const app = criarApp();
  app.listen(config.porta, () => {
    logInfo(`Totem de atendimento rodando em http://localhost:${config.porta}`);
  });
}

iniciar().catch((erro) => {
  logErro('inicialização do servidor', erro);
  console.error('[ERRO] Não foi possível iniciar:', erro.message);
  process.exit(1);
});

