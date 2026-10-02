/**
 * errors.js
 * define os tipos de erros que o sistema pode ter
 * ---------
 * Classes de erro personalizadas. Cada erro carrega:
 *  - um "statusCode" HTTP (o que o front recebe)
 *  - uma "mensagemPublica" (genérica, segura de mostrar ao usuário do totem)
 * O detalhe tecnico completo (stack trace) NUNCA sai daqui: quem trata
 * isso e o errorHandler.js, que loga tudo no servidor e devolve so a
 * mensagem publica.
 */

class ErroDeAplicacao extends Error {
  constructor(mensagemPublica, statusCode = 500, detalhesInternos = null) {
    super(mensagemPublica);
    this.statusCode = statusCode;
    this.mensagemPublica = mensagemPublica;
    this.detalhesInternos = detalhesInternos;
    this.isErroTratado = true; // diferencia erro "esperado" de bug inesperado
  }
}

class ErroDeValidacao extends ErroDeAplicacao {
  constructor(mensagemPublica, detalhesInternos = null) {
    super(mensagemPublica, 400, detalhesInternos);
  }
}

class ErroDeBancoDeDados extends ErroDeAplicacao {
  constructor(detalhesInternos) {
    // Mensagem publica GENERICA de proposito: nunca expor nome de tabela,
    // driver, versao do SGBD ou trecho do SQL para quem esta no totem.
    super('Não foi possível concluir a operação. Tente novamente em instantes.', 503, detalhesInternos);
  }
}

class ErroDeIndisponibilidade extends ErroDeAplicacao {
  constructor(mensagemPublica = 'Serviço temporariamente indisponível. Tente novamente em instantes.', detalhesInternos = null) {
    super(mensagemPublica, 503, detalhesInternos);
  }
}

module.exports = { ErroDeAplicacao, ErroDeValidacao, ErroDeBancoDeDados, ErroDeIndisponibilidade };
