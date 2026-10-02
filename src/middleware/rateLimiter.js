/**
 * rateLimiter.js
 * --------------
 * PILAR 3 - RATE LIMITING (LIMITE DE REQUISICOES)
 * -------------------------------------------------
 * Objetivo do enunciado: impedir que o mesmo cliente fique "apertando
 * cadastrar 500 milhoes de vezes" - ou seja, requisicoes sucessivas
 * demais em pouco tempo (ataque de forca bruta, bot, ou so um usuario
 * afobado no totem).
 *
 * Estrategia: janela deslizante por IP, guardada em memoria (Map).
 * Para cada IP, guardamos os timestamps das requisicoes recentes.
 * A cada nova requisicao:
 *   1. Removemos da lista os timestamps mais antigos que a janela (ex.: 60s)
 *   2. Se o que sobrou + a nova requisicao ultrapassa o limite -> bloqueia
 *      com HTTP 429 (Too Many Requests) e informa Retry-After
 *   3. Caso contrario, registra o timestamp e deixa passar
 *
 * Em producao isso normalmente fica no Redis (para funcionar com varias
 * instancias do servidor), mas em memoria e suficiente para o projeto
 * e deixa o mecanismo bem visivel para a apresentacao.
 */

const { logInfo } = require('../logger');

// registro[ip] = [timestamp1, timestamp2, ...]
const registro = new Map();

// registroBloqueados[ip] = timestamp em que o bloqueio expira
const bloqueados = new Map();

function limparAntigos(lista, agora, janelaMs) {
  return lista.filter((t) => agora - t < janelaMs);
}

function criarRateLimiter({ limite = 10, janelaMs = 60_000, tempoBloqueioMs = 60_000 } = {}) {
  return function rateLimiter(req, res, next) {
    const ip = req.ip;
    const agora = Date.now();

    // 1) Se o IP esta atualmente bloqueado, nega direto.
    const desbloqueiaEm = bloqueados.get(ip);
    if (desbloqueiaEm && agora < desbloqueiaEm) {
      const segundosRestantes = Math.ceil((desbloqueiaEm - agora) / 1000);
      res.set('Retry-After', String(segundosRestantes));
      return res.status(429).json({
        sucesso: false,
        erro: `Muitas tentativas. Tente novamente em ${segundosRestantes}s.`,
      });
    }
    if (desbloqueiaEm && agora >= desbloqueiaEm) {
      bloqueados.delete(ip); // bloqueio expirou
    }

    // 2) Atualiza a janela deslizante de requisicoes desse IP.
    const historico = limparAntigos(registro.get(ip) || [], agora, janelaMs);
    historico.push(agora);
    registro.set(ip, historico);

    // 3) Excedeu o limite dentro da janela? Bloqueia temporariamente.
    if (historico.length > limite) {
      bloqueados.set(ip, agora + tempoBloqueioMs);
      registro.delete(ip);
      logInfo(`IP bloqueado temporariamente por excesso de requisições`, {
        ip,
        limite,
        janelaMs,
        tempoBloqueioMs,
      });
      const segundosRestantes = Math.ceil(tempoBloqueioMs / 1000);
      res.set('Retry-After', String(segundosRestantes));
      return res.status(429).json({
        sucesso: false,
        erro: `Muitas tentativas. Tente novamente em ${segundosRestantes}s.`,
      });
    }

    next();
  };
}

module.exports = { criarRateLimiter };
