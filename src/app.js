/**
 * app.js
 * monta a aplicação Express e exporta, sem subir o servidor
 * ------
 * Monta a aplicação Express (rotas, middlewares, pilares de segurança)
 * e a exporta, sem subir o servidor. Isso permite reutilizar o "app"
 * tanto no entrypoint real (src/server.js) quanto nos testes
 * automatizados (tests/), sem precisar abrir uma porta de verdade.
 *
 * Junta os três pilares:
 *   1) Prevenção de SQL Injection  -> ./db.js (queries parametrizadas)
 *   2) Gestão de erros no servidor -> ./middleware/errorHandler.js
 *   3) Rate limiting                -> ./middleware/rateLimiter.js
 */

const express = require('express');
const path = require('path');
const { errorHandler, rotaNaoEncontrada } = require('./middleware/errorHandler');
const rotasEstacionamento = require('./routes/estacionamento');
const rotasOperador = require('./routes/operador');

function criarApp() {
  const app = express();

  app.disable('x-powered-by'); // não expõe tecnologia usada (boa prática extra)

  // Atrás do proxy do host (Render, etc.) o IP real do cliente vem no cabeçalho
  // X-Forwarded-For. Sem isto, o rate limiter (Pilar 3) enxergaria TODOS os
  // usuários como um único IP (o do proxy) e bloquearia todo mundo junto.
  const proxies = process.env.TRUST_PROXY
    ? Number(process.env.TRUST_PROXY)
    : process.env.NODE_ENV === 'production' ? 1 : 0;
  if (proxies) app.set('trust proxy', proxies);
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'assets')));

  // PILAR 3: o rate limiter agora é aplicado dentro de
  // ./routes/estacionamento.js, apenas nas rotas de escrita
  // (/entrada e /saida) — ver comentário lá para o motivo.
  app.use('/api', rotasEstacionamento);

  // Área do operador: login (senha com hash bcrypt) e painel com placa mascarada.
  app.use('/api/operador', rotasOperador);

  app.get('/api/status', (req, res) => {
    res.json({ sucesso: true, status: 'online', hora: new Date().toISOString() });
  });

  // Responde sobre a saúde do hardware/rede.
  // IMPORTANTE: precisa vir ANTES de rotaNaoEncontrada/errorHandler,
  // já que esses dois middlewares não têm filtro de caminho e
  // interceptariam essa rota antes dela ser executada.
  app.get('/api/health', async (req, res) => {
    try {
      // Testa se o Postgres continua respondendo (se a rede caiu ou o banco pausou, isso falha)
      const { verificarConexao } = require('./db');
      await verificarConexao();

      return res.status(200).json({
        status: 'operacional',
        infraestrutura: {
          rede: 'conectada',
          bancoDeDados: 'ativo',
          eletricidadeNoTotem: 'estavel', // Simulação de status de hardware
        },
        mensagem: 'Todos os sistemas operando normalmente.',
      });
    } catch (erroDeHardware) {
      // Captura falhas críticas de infraestrutura (queda de energia, banco inacessível, cabo de rede rompido)
      return res.status(503).json({
        status: 'critico',
        erro: 'Falha de infraestrutura detectada no totem.',
        detalhePublico: 'Serviço temporariamente indisponível por instabilidade de rede ou energia.',
      });
    }
  });

  // PILAR 2 (parte 1): rota não encontrada tratada explicitamente.
  app.use(rotaNaoEncontrada);

  // PILAR 2 (parte 2): middleware final de erros. Tem que ser o ÚLTIMO
  // app.use() da cadeia, com 4 argumentos, para o Express reconhecer
  // como error handler.
  app.use(errorHandler);

  return app;
}

module.exports = { criarApp };
