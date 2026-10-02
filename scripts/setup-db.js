/**
 * setup-db.js
 * -----------
 * Prepara o banco: cria as tabelas, os valores-semente, o usuário restrito
 * "totem_app" (menor privilégio) e as regras de RLS. Executa db/schema.sql.
 *
 * Precisa de:
 *   ADMIN_DATABASE_URL  conexão do ADMINISTRADOR do banco (no Supabase: usuário postgres)
 *   APP_DB_PASSWORD     senha que o usuário totem_app vai ter (use letras e números)
 *
 * Uso:  npm run db:setup
 * Pode rodar mais de uma vez (o schema é idempotente).
 */

const fs = require('fs');
const path = require('path');
const { criarPool } = require('../src/conexao');
const config = require('../config/config');

(async () => {
  const senhaApp = process.env.APP_DB_PASSWORD || '';
  if (!config.banco.urlAdmin) {
    console.error('Defina ADMIN_DATABASE_URL no .env (veja .env.example).');
    process.exit(1);
  }
  if (senhaApp.length < 12 || !/^[A-Za-z0-9_-]+$/.test(senhaApp)) {
    console.error('Defina APP_DB_PASSWORD no .env: mínimo 12 caracteres, só letras, números, "_" ou "-".');
    process.exit(1);
  }

  const sql = fs
    .readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
    .replaceAll('__SENHA_DO_APP__', senhaApp); // aparece em mais de um lugar
  if (sql.includes('__SENHA_DO_APP__')) {
    console.error('Marcador da senha não foi substituído em db/schema.sql.');
    process.exit(1);
  }

  const admin = criarPool(config.banco.urlAdmin, { max: 1 });
  try {
    await admin.query(sql);
    console.log('Banco preparado: tabelas, configuração inicial, usuário "totem_app" e permissões.');
    console.log('Próximo passo: npm run operador:criar -- admin');
  } catch (erro) {
    console.error('Falha ao preparar o banco:', erro.message);
    process.exitCode = 1;
  } finally {
    await admin.end();
  }
})();
