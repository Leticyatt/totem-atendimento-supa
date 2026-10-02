/**
 * errorHandler.js
 * ---------------
 * PILAR 2 - GESTAO DE ERROS DO LADO DO SERVIDOR
 * camada de proteção que roda antes das rotas
 * ----------------------------------------------
 * Ideia central: "log detalhado para o desenvolvedor, mensagem generica
 * para o usuario". Um Stack Trace no navegador revela linguagem, versao
 * de framework, nomes de tabela e caminho de arquivos no servidor -
 * informacao valiosa para quem quer atacar o sistema. Por isso ela NUNCA
 * deve sair daqui para o cliente.
 *
 * Este middleware fica no final da cadeia do Express (depois de todas as
 * rotas) e captura QUALQUER erro lancado com next(erro) ou por uma
 * excecao dentro de uma rota assincrona envolvida em asyncHandler.
 */

const { logErro } = require('../logger');
const { ErroDeAplicacao } = require('../errors');

function errorHandler(erro, req, res, _next) {
  // 1) Sempre loga o detalhe TECNICO completo no servidor.
  logErro(`${req.method} ${req.originalUrl}`, erro, {
    ip: req.ip,
    body: req.body,
  });

  // 2) Decide o que o CLIENTE recebe.
  if (erro.isErroTratado || erro instanceof ErroDeAplicacao) {
    // Erro "esperado" (validacao, banco fora do ar, etc.): mensagem
    // ja pensada para ser segura de mostrar.
    return res.status(erro.statusCode || 400).json({
      sucesso: false,
      erro: erro.mensagemPublica,
    });
  }

  // 3) Qualquer coisa nao prevista (bug real) cai aqui. Mensagem
  // 100% generica - nunca erro.message ou erro.stack no JSON de resposta.
  return res.status(500).json({
    sucesso: false,
    erro: 'Ocorreu um erro inesperado. Nossa equipe já foi notificada.',
  });
}

// Envolve rotas assincronas para que qualquer "throw" ou Promise rejeitada
// va automaticamente para o errorHandler, em vez de derrubar o processo
// ou ficar "pendurada" sem resposta.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Middleware final para rotas que nao existem (404) - tambem e "gestao
// de erro do lado do servidor", so que para uma rota inexistente.
function rotaNaoEncontrada(req, res) {
  res.status(404).json({ sucesso: false, erro: 'Recurso não encontrado.' });
}

module.exports = { errorHandler, asyncHandler, rotaNaoEncontrada };
