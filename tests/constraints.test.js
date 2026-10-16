/**
 * tests/constraints.test.js
 * testes das restrições de validação (CHECK) da tabela veiculos
 * ---------------------------------------------------------------
 * Roda com: npm test  (junto com os demais testes)
 * Usa o banco de TESTE (ver tests/helpers.js) e aplica db/constraints.sql nele
 * antes de começar (o script é idempotente).
 *
 * Os testes de "recusa" inserem direto no banco como administrador, de
 * propósito: simulam alguém que contornou a validação do back-end. O erro
 * esperado é o código 23514 (check_violation) do PostgreSQL.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pronto, opcoesDeTeste, criarAdmin, limparTabelas, subirServidorDeTeste, requisitar } = require('./helpers');

const admin = pronto ? criarAdmin() : null;
const { criarApp } = pronto ? require('../src/app') : {};

let seq = 0;
const novoTicket = () => `T-CK-${Date.now().toString(36)}-${seq++}`;

async function inserir(placa = null) {
  const { rows } = await admin.query(
    `INSERT INTO veiculos (ticket, placa, tipo) VALUES ($1, $2, 'carro') RETURNING id`,
    [novoTicket(), placa]
  );
  return rows[0].id;
}

// Espera que o banco recuse com check_violation na regra indicada.
async function esperaRecusa(promessa, nomeDaRegra) {
  await assert.rejects(promessa, (erro) => {
    assert.equal(erro.code, '23514', `esperava check_violation (23514), veio ${erro.code}: ${erro.message}`);
    assert.equal(erro.constraint, nomeDaRegra);
    return true;
  });
}

test.before(async () => {
  if (!pronto) return;
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'constraints.sql'), 'utf8');
  await admin.query(sql);
  await limparTabelas(admin);
});

test.after(async () => {
  if (pronto) await admin.end();
});

test('CHECK valor_pago: negativo e zero são recusados pelo banco', opcoesDeTeste, async () => {
  const id = await inserir('ABC1234');
  await esperaRecusa(admin.query('UPDATE veiculos SET valor_pago = -10 WHERE id = $1', [id]), 'ck_valor_pago_positivo');
  await esperaRecusa(admin.query('UPDATE veiculos SET valor_pago = 0 WHERE id = $1', [id]), 'ck_valor_pago_positivo');
});

test('CHECK valor_pago: valor positivo e NULL (ainda no pátio) passam', opcoesDeTeste, async () => {
  const id = await inserir('ABC1D23');
  await admin.query('UPDATE veiculos SET valor_pago = 13.00 WHERE id = $1', [id]);
  await admin.query('UPDATE veiculos SET valor_pago = NULL WHERE id = $1', [id]);
});

test('CHECK saida: saída antes da entrada é recusada; saída depois passa', opcoesDeTeste, async () => {
  const id = await inserir('XYZ9876');
  await esperaRecusa(
    admin.query(`UPDATE veiculos SET saida = entrada - interval '1 hour' WHERE id = $1`, [id]),
    'ck_saida_apos_entrada'
  );
  await admin.query(`UPDATE veiculos SET saida = entrada + interval '1 hour' WHERE id = $1`, [id]);
});

test('CHECK placa: formato inválido é recusado; ABC1234, ABC1D23 e NULL passam', opcoesDeTeste, async () => {
  await esperaRecusa(inserir('AB-123'), 'ck_placa_formato');
  await esperaRecusa(inserir('abc1234'), 'ck_placa_formato'); // o back-end normaliza para maiúsculas antes de gravar
  await esperaRecusa(inserir('ABCD123'), 'ck_placa_formato');
  await inserir('ABC1234');
  await inserir('ABC1D23');
  await inserir(null);
});

test('Integração: se uma regra do banco barrar a saída, o usuário vê mensagem genérica (Pilar 2)', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(criarApp);
  t.after(() => servidor.close());

  const entrada = await requisitar(servidor, 'POST', '/api/entrada', { placa: 'QWE1R23', tipo: 'carro' });
  assert.equal(entrada.status, 201);
  const codigo = entrada.corpo.ticket.ticket;

  // Simula uma tarifa mal configurada (0): o back-end tentaria gravar valor_pago = 0.
  const { rows } = await admin.query(`SELECT valor FROM configuracao WHERE chave = 'valor_carro'`);
  const valorOriginal = rows[0].valor;
  await admin.query(`UPDATE configuracao SET valor = '0' WHERE chave = 'valor_carro'`);
  t.after(() => admin.query(`UPDATE configuracao SET valor = $1 WHERE chave = 'valor_carro'`, [valorOriginal]));

  const saida = await requisitar(servidor, 'POST', '/api/saida', { ticket: codigo });
  assert.equal(saida.status, 503);
  assert.equal(saida.corpo.sucesso, false);
  const texto = JSON.stringify(saida.corpo);
  assert.ok(!texto.includes('ck_valor_pago_positivo'), 'nome da regra não pode vazar para o usuário');
  assert.ok(!/check|constraint|veiculos/i.test(texto), 'detalhe técnico não pode vazar para o usuário');

  // O veículo continua "dentro": nada foi gravado pela metade.
  const { rows: depois } = await admin.query('SELECT status, valor_pago FROM veiculos WHERE ticket = $1', [codigo]);
  assert.equal(depois[0].status, 'dentro');
  assert.equal(depois[0].valor_pago, null);
});
