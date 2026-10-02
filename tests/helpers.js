/**
 * tests/helpers.js
 * ----------------
 * Utilitários compartilhados pelos testes.
 *
 * Os testes precisam de um banco PostgreSQL SÓ PARA TESTE (local, ou um segundo
 * projeto no Supabase), já preparado com `npm run db:setup`. Defina no .env:
 *
 *   TEST_DATABASE_URL        conexão do usuário restrito totem_app do banco de teste
 *   TEST_ADMIN_DATABASE_URL  conexão do administrador do banco de teste
 *
 * ATENÇÃO: os testes APAGAM os dados de veiculos e operadores do banco de teste.
 * Por segurança, eles se recusam a rodar se a URL de teste for igual à de produção.
 * Sem essas variáveis, os testes são pulados (skip) em vez de falhar.
 */

const http = require('node:http');

require('dotenv').config({ quiet: true });

const urlApp = process.env.TEST_DATABASE_URL || '';
const urlAdmin = process.env.TEST_ADMIN_DATABASE_URL || '';

if (urlApp && (urlApp === process.env.DATABASE_URL || urlAdmin === process.env.ADMIN_DATABASE_URL)) {
  throw new Error('TEST_* não pode apontar para o mesmo banco de DATABASE_URL/ADMIN_DATABASE_URL (os testes apagam dados).');
}

const pronto = Boolean(urlApp && urlAdmin);
const opcoesDeTeste = pronto
  ? {}
  : { skip: 'defina TEST_DATABASE_URL e TEST_ADMIN_DATABASE_URL (banco de teste) no .env' };

if (pronto) {
  // Faz a aplicação usar o banco de teste. Precisa vir ANTES de importar src/.
  process.env.DATABASE_URL = urlApp;
  process.env.ADMIN_DATABASE_URL = urlAdmin;
  process.env.TOTEM_BCRYPT_COST = '4'; // custo mínimo só nos testes, para rodarem rápido
}

function criarAdmin() {
  const { criarPool } = require('../src/conexao');
  return criarPool(urlAdmin, { max: 2 });
}

async function limparTabelas(admin) {
  await admin.query('TRUNCATE veiculos, operadores RESTART IDENTITY');
}

function subirServidorDeTeste(criarApp) {
  const servidor = http.createServer(criarApp());
  return new Promise((resolve) => servidor.listen(0, () => resolve(servidor)));
}

function requisitar(servidor, metodo, caminho, corpo, cabecalhos = {}) {
  const { port } = servidor.address();
  const dados = corpo ? JSON.stringify(corpo) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: caminho,
        method: metodo,
        headers: {
          ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados) } : {}),
          ...cabecalhos,
        },
      },
      (res) => {
        let bruto = '';
        res.on('data', (c) => (bruto += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(bruto); } catch { /* corpo vazio/não-JSON */ }
          resolve({ status: res.statusCode, corpo: json });
        });
      }
    );
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

module.exports = { pronto, opcoesDeTeste, criarAdmin, limparTabelas, subirServidorDeTeste, requisitar };
