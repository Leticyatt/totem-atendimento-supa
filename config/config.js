/**
 * config.js
 * ---------
 * Configurações da aplicação, centralizadas em um único lugar
 * (em vez de espalhadas/hardcoded pelo código-fonte).
 *
 * Qualquer valor "de negócio" (tarifas, vagas, limites de requisição,
 * porta do servidor) deve ser lido a partir daqui.
 */

// Carrega o arquivo .env (se existir) para dentro de process.env. É de lá
// que vêm as conexões do banco: segredo fica fora do código.
require('dotenv').config({ quiet: true });

module.exports = {
  // Porta do servidor HTTP. Pode ser sobrescrita por variável de ambiente.
  porta: process.env.PORT || 3000,

  // PILAR 3 - Rate limiting: limite de requisições sucessivas por IP
  // nas rotas da API (ex.: alguém "apertando" o botão de entrada/saída
  // repetidas vezes, ou tentando adivinhar tickets).
  rateLimiter: {
    limite: 10,          // requisições permitidas
    janelaMs: 60_000,     // por janela de 60s
    tempoBloqueioMs: 60_000, // tempo de bloqueio ao estourar o limite
  },

  // Banco de dados (PostgreSQL / Supabase). As URLs são segredos: só no .env.
  banco: {
    // Conexão da APLICAÇÃO: usuário restrito "totem_app" (Recurso 3).
    url: process.env.DATABASE_URL || '',
    // Conexão do ADMINISTRADOR: usada só por db:setup e operador:criar,
    // direto do seu computador. NÃO coloque esta variável no servidor.
    urlAdmin: process.env.ADMIN_DATABASE_URL || '',
  },

  // Configuração padrão do pátio de estacionamento (valores-semente,
  // iguais aos inseridos no banco por db/schema.sql).
  patio: {
    vagasTotaisCarro: 50,
    vagasTotaisMoto: 10,
    valorCarro: 13.0, // tarifa fixa por veículo tipo "carro"
    valorMoto: 10.0,  // tarifa fixa por veículo tipo "moto"
  },

  // Recursos de segurança no armazenamento (ver docs/recursos-armazenamento.md)
  seguranca: {
    // Recurso 2 - custo do bcrypt (12 = lento de propósito; testes usam 4).
    bcryptCusto: Number(process.env.TOTEM_BCRYPT_COST) || 12,
    // Login do operador: bloqueio após N falhas seguidas.
    loginMaxFalhas: 5,
    loginBloqueioMs: 60_000,
    sessaoMs: 8 * 60 * 60 * 1000, // sessão do operador dura 8h
  },
};
