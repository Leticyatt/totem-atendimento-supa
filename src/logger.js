/**
 * logger.js
 * registra erros tecnicos detalhados em arquivo (logs/erros.log) e tambem no console do servidor
 * ---------
 * Log tecnico DETALHADO, guardado em arquivo (logs/erros.log) e tambem
 * exibido no console do servidor. Isso e o que o desenvolvedor consulta
 * para investigar um problema - e nunca o que o usuario do totem ve.
 */

const fs = require('fs');
const path = require('path');
const { sanitizarExtraParaLog } = require('./seguranca/mascaramento');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, 'erros.log');

function logErro(contexto, erro, extra = {}) {
  const registro = {
    quando: new Date().toISOString(),
    contexto,
    mensagem: erro.message,
    // Detalhe técnico real (ex.: erro original do Postgres). Fica SÓ no log,
    // nunca na resposta ao cliente (a mensagem pública é outra, ver errors.js).
    detalhesInternos: erro.detalhesInternos || undefined,
    stack: erro.stack,
    // RECURSO 4 - Mascaramento: placa mascarada e senha/token ocultos no log.
    ...sanitizarExtraParaLog(extra),
  };
  const linha = JSON.stringify(registro) + '\n';
  fs.appendFileSync(logFile, linha);
  // Em desenvolvimento tambem imprime no console; em producao isso
  // normalmente vai para uma ferramenta tipo Winston/Datadog/Sentry.
  console.error(`[ERRO] ${registro.quando} | ${contexto} | ${erro.message}`);
}

function logInfo(mensagem, extra = {}) {
  console.log(`[INFO] ${new Date().toISOString()} | ${mensagem}`, extra);
}

module.exports = { logErro, logInfo };
