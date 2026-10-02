/**
 * tests/pilares.test.js
 * os testes automatizados dos 3 pilares de segurança
 * ----------------------
 * Testes automatizados dos 3 pilares de segurança exigidos no trabalho:
 *   1) Prevenção de SQL Injection
 *   2) Gestão de erros no servidor
 *   3) Rate limiting
 *
 * Roda com: npm test
 * Usa um banco PostgreSQL de TESTE (ver tests/helpers.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { pronto, opcoesDeTeste, criarAdmin, limparTabelas, subirServidorDeTeste, requisitar } = require('./helpers');

const admin = pronto ? criarAdmin() : null;
const app = pronto ? require('../src/app') : null;
const dbModulo = pronto ? require('../src/db') : null;

test.before(async () => {
  if (pronto) await limparTabelas(admin);
});

test('PILAR 1 - SQL Injection: placa maliciosa é tratada como dado, não como comando SQL', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(app.criarApp);
  t.after(() => servidor.close());

  const placaMaliciosa = "' OR '1'='1'; DROP TABLE veiculos; --";

  const resposta = await requisitar(servidor, 'POST', '/api/entrada', {
    placa: placaMaliciosa,
    tipo: 'carro',
  });

  // O servidor não quebra nem executa o SQL malicioso: responde com erro de
  // validação (400) — nunca com erro de sintaxe SQL ou tabela apagada.
  assert.ok([200, 201, 400, 422].includes(resposta.status));

  // Também no código do ticket (outro ponto de entrada de texto livre).
  const ticketMalicioso = await requisitar(servidor, 'GET', `/api/ticket/${encodeURIComponent("x'; DROP TABLE veiculos; --")}`);
  assert.equal(ticketMalicioso.status, 400); // "Ticket não encontrado", tratado como texto

  // A tabela "veiculos" precisa continuar existindo (não foi derrubada).
  const existe = await admin.query(`SELECT to_regclass('public.veiculos') AS tabela`);
  assert.equal(existe.rows[0].tabela, 'veiculos');
  assert.equal((await requisitar(servidor, 'GET', '/api/vagas')).status, 200);
});

test('PILAR 2 - Gestão de erros: rota inexistente retorna 404 com mensagem genérica', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(app.criarApp);
  t.after(() => servidor.close());

  const resposta = await requisitar(servidor, 'GET', '/api/rota-que-nao-existe');

  assert.equal(resposta.status, 404);
  // Mensagem deve ser genérica para o usuário (sem stack trace, sem
  // detalhes internos do servidor vazando na resposta).
  assert.ok(resposta.corpo);
  const textoResposta = JSON.stringify(resposta.corpo).toLowerCase();
  assert.ok(!textoResposta.includes('at ') && !textoResposta.includes('.js:'));
});

test('PILAR 2 - Gestão de erros: falha real do banco vira 503 com mensagem genérica (sem detalhe do Postgres)', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(app.criarApp);
  t.after(() => servidor.close());

  // Byte nulo no texto: o Postgres recusa, e o erro técnico fica só no log.
  const resposta = await requisitar(servidor, 'GET', '/api/ticket/ABC%00');
  assert.equal(resposta.status, 503);
  const texto = JSON.stringify(resposta.corpo).toLowerCase();
  for (const vazamento of ['postgres', 'invalid byte', 'sequence', 'veiculos', 'select', 'pg_']) {
    assert.ok(!texto.includes(vazamento), `a resposta vazou "${vazamento}"`);
  }
});

test('PILAR 2 - /api/health responde 200 com o banco no ar', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(app.criarApp);
  t.after(() => servidor.close());
  const resposta = await requisitar(servidor, 'GET', '/api/health');
  assert.equal(resposta.status, 200);
  assert.equal(resposta.corpo.infraestrutura.bancoDeDados, 'ativo');
});

test('PILAR 3 - Rate limiting: bloqueia após exceder o limite de requisições na rota de escrita', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(app.criarApp);
  t.after(() => servidor.close());

  const respostas = [];
  // O limite padrão é 10 por janela; disparamos mais que isso contra uma
  // rota de ESCRITA (/entrada), que é onde o limitador é aplicado
  // (rotas de leitura como /vagas e /tarifas ficam de fora de propósito).
  for (let i = 0; i < 12; i++) {
    // eslint-disable-next-line no-await-in-loop
    respostas.push(await requisitar(servidor, 'POST', '/api/entrada', { tipo: 'carro' }));
  }

  const bloqueadas = respostas.filter((r) => r.status === 429);
  assert.ok(bloqueadas.length > 0, 'esperava pelo menos uma resposta 429 (Too Many Requests)');
});

test('PILAR 3 - Rate limiting: rotas de leitura (/vagas) não são bloqueadas', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(app.criarApp);
  t.after(() => servidor.close());

  const respostas = [];
  for (let i = 0; i < 15; i++) {
    // eslint-disable-next-line no-await-in-loop
    respostas.push(await requisitar(servidor, 'GET', '/api/vagas'));
  }

  const bloqueadas = respostas.filter((r) => r.status === 429);
  assert.equal(bloqueadas.length, 0, 'consultas de leitura não deveriam ser limitadas');
});

test.after(async () => {
  if (!pronto) return;
  await limparTabelas(admin);
  await dbModulo.fecharConexoes();
  await admin.end();
});
