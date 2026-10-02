/**
 * autenticacao.js
 * ---------------
 * Login do operador e proteção das rotas internas.
 *
 * Fluxo: POST /api/operador/login confere usuário e senha (hash bcrypt, ver
 * operadores.js) e devolve um token aleatório. As rotas protegidas exigem
 * esse token no cabeçalho "Authorization: Bearer <token>".
 *
 * Os tokens ficam só em memória e expiram (config.seguranca.sessaoMs).
 * Reiniciar o servidor derruba as sessões. Para o projeto isso basta; em
 * produção seria um armazenamento de sessão de verdade (ex.: Redis).
 *
 * Contra força bruta no login: depois de N falhas seguidas do mesmo IP para
 * o mesmo usuário, o login fica bloqueado por um tempo (HTTP 429).
 * Esse controle é próprio do login e não mexe no rate limiter do Pilar 3.
 */

const crypto = require('crypto');
const { ErroDeAplicacao, ErroDeValidacao } = require('../errors');
const { verificarCredenciais } = require('./operadores');
const config = require('../../config/config');

const sessoes = new Map(); // token -> { usuario, expiraEm }
const falhas = new Map(); // "ip|usuario" -> { quantidade, bloqueadoAte }

async function autenticar(usuario, senha, ip) {
  if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario || !senha) {
    throw new ErroDeValidacao('Informe usuário e senha.');
  }

  const chave = `${ip}|${usuario.toLowerCase()}`;
  const agora = Date.now();
  const registro = falhas.get(chave) || { quantidade: 0, bloqueadoAte: 0 };

  if (registro.bloqueadoAte > agora) {
    const segundos = Math.ceil((registro.bloqueadoAte - agora) / 1000);
    throw new ErroDeAplicacao(`Muitas tentativas de login. Tente novamente em ${segundos}s.`, 429);
  }

  const operador = await verificarCredenciais(usuario, senha);

  if (!operador) {
    registro.quantidade += 1;
    if (registro.quantidade >= config.seguranca.loginMaxFalhas) {
      registro.bloqueadoAte = agora + config.seguranca.loginBloqueioMs;
      registro.quantidade = 0;
    }
    falhas.set(chave, registro);
    // Mensagem igual para "usuário não existe" e "senha errada".
    throw new ErroDeAplicacao('Usuário ou senha inválidos.', 401);
  }

  falhas.delete(chave);
  const token = crypto.randomBytes(32).toString('hex');
  const expiraEm = agora + config.seguranca.sessaoMs;
  sessoes.set(token, { usuario: operador.usuario, expiraEm });
  return { token, expiraEm: new Date(expiraEm).toISOString() };
}

/** Middleware: só deixa passar quem mandou um token válido e não expirado. */
function exigirOperador(req, res, next) {
  const cabecalho = req.get('Authorization') || '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
  const sessao = token ? sessoes.get(token) : null;

  if (!sessao || sessao.expiraEm <= Date.now()) {
    if (sessao) sessoes.delete(token);
    return next(new ErroDeAplicacao('Autenticação necessária.', 401));
  }
  req.operador = sessao.usuario;
  return next();
}

module.exports = { autenticar, exigirOperador };
