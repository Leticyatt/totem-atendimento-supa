/**
 * conexao.js
 * ----------
 * Cria conexões (pools) com o PostgreSQL. Fica separado do db.js para ser
 * reutilizado por quem precisa de uma conexão diferente da do totem:
 *   - src/db.js ............ conexão da APLICAÇÃO (usuário restrito, DATABASE_URL)
 *   - scripts/setup-db.js .. conexão de ADMINISTRADOR (ADMIN_DATABASE_URL)
 *   - src/seguranca/criar-operador.js (idem, admin)
 *
 * Cuidados que ficam centralizados aqui:
 *   - SSL: bancos na nuvem (Supabase) exigem conexão cifrada. Em localhost
 *     não usamos SSL. Pode ser forçado com DATABASE_SSL=true|false.
 *   - NUMERIC e BIGINT chegam do Postgres como string; convertemos para número
 *     para a API devolver 13 e não "13.00" (como era no SQLite).
 */

const { Pool, types } = require('pg');

types.setTypeParser(1700, (valor) => parseFloat(valor)); // NUMERIC
types.setTypeParser(20, (valor) => parseInt(valor, 10)); // BIGINT (ex.: COUNT)

function resolverSsl(url, forcar = process.env.DATABASE_SSL) {
  if (forcar === 'false') return false;
  if (forcar === 'true') return { rejectUnauthorized: false };
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(host);
  // rejectUnauthorized:false = a conexão é cifrada, mas o Node não valida a
  // cadeia de certificados do provedor (o Supabase usa uma CA própria).
  return local ? false : { rejectUnauthorized: false };
}

function criarPool(url, opcoes = {}) {
  if (!url) {
    throw new Error('URL de conexão do banco não informada (veja .env.example).');
  }
  return new Pool({
    connectionString: url,
    ssl: resolverSsl(url),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000, // free tier "acorda" devagar
    ...opcoes,
  });
}

module.exports = { criarPool, resolverSsl };
