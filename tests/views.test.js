/**
 * tests/views.test.js
 * testes das views de ocultação e do usuário restrito suporte_leitura
 * ---------------------------------------------------------------
 * Roda com: npm test. Usa o banco de TESTE (ver tests/helpers.js) e aplica
 * db/views.sql nele antes de começar (o script é idempotente; a senha do
 * usuário de suporte é gerada na hora, só para o teste).
 *
 * Para agir "como o suporte", o administrador assume o papel com
 * SET LOCAL ROLE dentro de uma transação que sempre termina em ROLLBACK.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pronto, opcoesDeTeste, criarAdmin, limparTabelas } = require('./helpers');

const admin = pronto ? criarAdmin() : null;

// Executa um SQL como o usuário suporte_leitura e sempre desfaz no final.
async function comoSuporte(sql, params = []) {
  const cliente = await admin.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SET LOCAL ROLE suporte_leitura');
    return await cliente.query(sql, params);
  } finally {
    await cliente.query('ROLLBACK').catch(() => {});
    cliente.release();
  }
}

// Espera que o banco recuse por falta de permissão (42501).
async function esperaSemPermissao(promessa) {
  await assert.rejects(promessa, (erro) => {
    assert.equal(erro.code, '42501', `esperava permission denied (42501), veio ${erro.code}: ${erro.message}`);
    return true;
  });
}

test.before(async () => {
  if (!pronto) return;
  const senha = crypto.randomBytes(12).toString('hex');
  const sql = fs
    .readFileSync(path.join(__dirname, '..', 'db', 'views.sql'), 'utf8')
    .replaceAll('__SENHA_SUPORTE__', senha);
  await admin.query(sql);
  await limparTabelas(admin);
  await admin.query(`INSERT INTO operadores (usuario, senha_hash) VALUES ('op_teste', '$2a$04$hashfalsoapenasdeteste')`);
  await admin.query(`INSERT INTO veiculos (ticket, placa, tipo) VALUES ('T-VW-1', 'ABC1D23', 'carro')`);
  await admin.query(`INSERT INTO veiculos (ticket, placa, tipo) VALUES ('T-VW-2', NULL, 'moto')`);
  await admin.query(
    `INSERT INTO veiculos (ticket, placa, tipo, status, saida, valor_pago)
     VALUES ('T-VW-3', 'XYZ9876', 'carro', 'saiu', now(), 13.00)`
  );
});

test.after(async () => {
  if (pronto) await admin.end();
});

test('VIEW operadores: suporte lê usuario, mas a coluna senha_hash não existe na view', opcoesDeTeste, async () => {
  const { rows, fields } = await comoSuporte('SELECT * FROM vw_operadores_publico');
  assert.deepEqual(fields.map((f) => f.name), ['id', 'usuario', 'criado_em']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].usuario, 'op_teste');
  await assert.rejects(() => comoSuporte('SELECT senha_hash FROM vw_operadores_publico'), /senha_hash/);
});

test('VIEW pátio: placa sai mascarada, só veículos dentro, sem valor_pago', opcoesDeTeste, async () => {
  const { rows, fields } = await comoSuporte('SELECT * FROM vw_patio_publico ORDER BY ticket');
  assert.deepEqual(fields.map((f) => f.name), ['ticket', 'tipo', 'entrada', 'placa']);
  assert.deepEqual(rows.map((r) => r.ticket), ['T-VW-1', 'T-VW-2']); // o que saiu não aparece
  assert.equal(rows[0].placa, '***1D23');
  assert.equal(rows[1].placa, null);
});

test('GRANT: suporte NÃO acessa as tabelas originais (permission denied)', opcoesDeTeste, async () => {
  await esperaSemPermissao(comoSuporte('SELECT * FROM operadores'));
  await esperaSemPermissao(comoSuporte('SELECT * FROM veiculos'));
  await esperaSemPermissao(comoSuporte('SELECT * FROM configuracao'));
});

test('GRANT: suporte só lê as views (INSERT, UPDATE e DELETE são negados)', opcoesDeTeste, async () => {
  await esperaSemPermissao(comoSuporte(`INSERT INTO vw_operadores_publico (usuario) VALUES ('invasor')`));
  await esperaSemPermissao(comoSuporte(`UPDATE vw_operadores_publico SET usuario = 'x'`));
  await esperaSemPermissao(comoSuporte('DELETE FROM vw_patio_publico'));
});

test('API pública do Supabase (anon/authenticated) não enxerga as views', opcoesDeTeste, async () => {
  const { rows } = await admin.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')`);
  for (const { rolname } of rows) {
    for (const view of ['vw_operadores_publico', 'vw_patio_publico']) {
      const r = await admin.query('SELECT has_table_privilege($1, $2, $3) AS pode', [rolname, view, 'SELECT']);
      assert.equal(r.rows[0].pode, false, `${rolname} não deveria ler ${view}`);
    }
  }
});
