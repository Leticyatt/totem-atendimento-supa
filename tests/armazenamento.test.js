/**
 * tests/armazenamento.test.js
 * testes automatizados dos 4 recursos de segurança no armazenamento
 * ---------------------------------------------------------------
 *   1) Criptografia (em repouso: provedor do banco; em trânsito: SSL)
 *   2) Hashing de senhas (bcrypt + salt)
 *   3) Princípio do menor privilégio (usuário restrito no PostgreSQL)
 *   4) Mascaramento de dados (Data Masking)
 *
 * Roda com: npm test  (junto com tests/pilares.test.js)
 * Usa um banco PostgreSQL de TESTE (ver tests/helpers.js).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pronto, opcoesDeTeste, criarAdmin, limparTabelas, subirServidorDeTeste, requisitar } = require('./helpers');

const admin = pronto ? criarAdmin() : null;
const { criarApp } = pronto ? require('../src/app') : {};
const dbModulo = pronto ? require('../src/db') : {};
const { criarOperador } = pronto ? require('../src/seguranca/operadores') : {};
const { resolverSsl } = require('../src/conexao');
const { mascararPlaca } = require('../src/seguranca/mascaramento');

const ARQUIVO_LOG = path.join(__dirname, '..', 'logs', 'erros.log');

test.before(async () => {
  if (pronto) await limparTabelas(admin);
});

test('RECURSO 1 - Criptografia: conexão com banco remoto é cifrada (SSL); localhost não precisa', () => {
  // Em trânsito: qualquer banco que não seja local exige SSL.
  assert.ok(resolverSsl('postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com:5432/postgres', undefined));
  assert.equal(resolverSsl('postgresql://u:p@localhost:5432/postgres', undefined), false);
  assert.equal(resolverSsl('postgresql://u:p@127.0.0.1:5432/postgres', undefined), false);
  // Pode ser forçado nos dois sentidos pela variável DATABASE_SSL.
  assert.equal(resolverSsl('postgresql://u:p@aws-0-sa-east-1.pooler.supabase.com/postgres', 'false'), false);
  assert.ok(resolverSsl('postgresql://u:p@localhost/postgres', 'true'));
  // Em repouso: os discos do banco são cifrados pelo provedor (Supabase) - ver docs.
});

test('RECURSO 2 - Hashing de senhas: banco guarda hash bcrypt com salt, nunca a senha', opcoesDeTeste, async () => {
  const senha = 'SenhaForte#2026';
  await criarOperador('ana', senha, admin);
  await criarOperador('bia', senha, admin); // mesma senha, outro usuário

  const { rows } = await dbModulo.pool.query(
    `SELECT usuario, senha_hash FROM operadores WHERE usuario IN ('ana', 'bia') ORDER BY usuario`
  );
  const [ana, bia] = rows;

  assert.match(ana.senha_hash, /^\$2[aby]\$\d{2}\$/, 'esperava formato bcrypt');
  assert.ok(!ana.senha_hash.includes(senha), 'senha em texto puro não pode estar no hash');
  assert.notEqual(ana.senha_hash, bia.senha_hash, 'mesma senha deve gerar hashes diferentes (salt)');

  // Cadastro recusa senha curta e usuário repetido.
  await assert.rejects(() => criarOperador('carla', '123', admin), /Senha inválida/);
  await assert.rejects(() => criarOperador('ana', senha, admin), /Já existe/);
});

test('RECURSO 2 - Login: senha certa entra; senha errada e usuário inexistente recebem a mesma resposta', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(criarApp);
  t.after(() => servidor.close());
  await criarOperador('dora', 'OutraSenha#2026', admin);

  const ok = await requisitar(servidor, 'POST', '/api/operador/login', { usuario: 'dora', senha: 'OutraSenha#2026' });
  assert.equal(ok.status, 200);
  assert.match(ok.corpo.token, /^[0-9a-f]{64}$/);

  const senhaErrada = await requisitar(servidor, 'POST', '/api/operador/login', { usuario: 'dora', senha: 'errada-errada' });
  const naoExiste = await requisitar(servidor, 'POST', '/api/operador/login', { usuario: 'fantasma', senha: 'qualquer-coisa' });
  assert.equal(senhaErrada.status, 401);
  assert.equal(naoExiste.status, 401);
  assert.deepEqual(senhaErrada.corpo, naoExiste.corpo);
});

test('RECURSO 2 - Login: bloqueia temporariamente após várias senhas erradas', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(criarApp);
  t.after(() => servidor.close());
  await criarOperador('eva', 'SenhaDaEva#2026', admin);

  const status = [];
  for (let i = 0; i < 6; i++) {
    // eslint-disable-next-line no-await-in-loop
    status.push((await requisitar(servidor, 'POST', '/api/operador/login', { usuario: 'eva', senha: `chute-${i}-xxxx` })).status);
  }
  assert.deepEqual(status, [401, 401, 401, 401, 401, 429]);

  // Mesmo com a senha certa, continua bloqueada durante a janela.
  const certaBloqueada = await requisitar(servidor, 'POST', '/api/operador/login', { usuario: 'eva', senha: 'SenhaDaEva#2026' });
  assert.equal(certaBloqueada.status, 429);
});

test('RECURSO 3 - Menor privilégio: o usuário da aplicação não é administrador e só faz o necessário', opcoesDeTeste, async () => {
  const { pool } = dbModulo;

  // O servidor confere com quem está conectado: tem que ser o usuário restrito.
  const privilegios = await dbModulo.verificarPrivilegios();
  assert.equal(privilegios.usuario, 'totem_app');
  assert.equal(privilegios.administrador, false);

  // O que a aplicação PRECISA fazer funciona.
  await assert.doesNotReject(() => pool.query('SELECT COUNT(*) FROM veiculos'));
  await assert.doesNotReject(() => pool.query('SELECT usuario, senha_hash FROM operadores'));
  await assert.doesNotReject(() => pool.query('SELECT valor FROM configuracao'));

  // O que ela NÃO precisa é recusado pelo próprio banco.
  await assert.rejects(() => pool.query('DELETE FROM veiculos'), /permission denied/i);
  await assert.rejects(() => pool.query('TRUNCATE veiculos'), /permission denied/i);
  await assert.rejects(() => pool.query('DROP TABLE veiculos'), /must be owner/i);
  await assert.rejects(() => pool.query('DROP TABLE operadores'), /must be owner/i);
  await assert.rejects(() => pool.query("UPDATE configuracao SET valor = '0'"), /permission denied/i);
  await assert.rejects(() => pool.query("INSERT INTO operadores (usuario, senha_hash) VALUES ('hacker', 'x')"), /permission denied/i);
  await assert.rejects(() => pool.query('CREATE TABLE intruso (id int)'), /permission denied/i);
  await assert.rejects(() => pool.query("CREATE ROLE intruso LOGIN"), /permission denied/i);

  // A tabela segue de pé.
  const existe = await admin.query(`SELECT to_regclass('public.veiculos') AS tabela`);
  assert.equal(existe.rows[0].tabela, 'veiculos');
});

test('RECURSO 3 - Menor privilégio: o fluxo completo do totem continua funcionando com o usuário restrito', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(criarApp);
  t.after(() => servidor.close());

  const entrada = await requisitar(servidor, 'POST', '/api/entrada', { placa: 'MOT1A23', tipo: 'moto' });
  assert.equal(entrada.status, 201);
  const ticket = entrada.corpo.ticket.ticket;

  assert.equal((await requisitar(servidor, 'GET', `/api/ticket/${ticket}`)).status, 200);

  const saida = await requisitar(servidor, 'POST', '/api/saida', { ticket });
  assert.equal(saida.status, 200);
  assert.equal(saida.corpo.resumo.valor, 10);
  assert.equal(typeof saida.corpo.resumo.valor, 'number');
});

test('INTEGRIDADE - Vagas: entradas simultâneas nunca passam do limite da área', opcoesDeTeste, async () => {
  await limparTabelas(admin);
  await admin.query(`UPDATE configuracao SET valor = '2' WHERE chave = 'vagas_totais_moto'`);
  try {
    // 8 motos tentam entrar AO MESMO TEMPO numa área de 2 vagas.
    const resultados = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        dbModulo.registrarEntradaSeHouverVaga(dbModulo.gerarTicket() + i, null, 'moto')
      )
    );
    assert.equal(resultados.filter(Boolean).length, 2, 'só 2 podem entrar');
    const { rows } = await admin.query(`SELECT COUNT(*)::int AS n FROM veiculos WHERE status = 'dentro' AND tipo = 'moto'`);
    assert.equal(rows[0].n, 2);
  } finally {
    await admin.query(`UPDATE configuracao SET valor = '10' WHERE chave = 'vagas_totais_moto'`);
  }
});

test('RECURSO 4 - Mascaramento: função mascara tudo menos os 4 últimos caracteres', () => {
  assert.equal(mascararPlaca('ABC1D23'), '***1D23');
  assert.equal(mascararPlaca('ABC1234'), '***1234');
  assert.equal(mascararPlaca('AB'), '**');
  assert.equal(mascararPlaca(null), null);
});

test('RECURSO 4 - Mascaramento: painel do operador exige login e mostra placa mascarada', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(criarApp);
  t.after(() => servidor.close());
  await criarOperador('fabio', 'SenhaDoFabio#2026', admin);

  const placa = 'ZXC9V87';
  await requisitar(servidor, 'POST', '/api/entrada', { placa, tipo: 'carro' });

  // Sem token: negado.
  assert.equal((await requisitar(servidor, 'GET', '/api/operador/painel')).status, 401);
  assert.equal((await requisitar(servidor, 'GET', '/api/operador/painel', null, { Authorization: 'Bearer token-falso' })).status, 401);

  const login = await requisitar(servidor, 'POST', '/api/operador/login', { usuario: 'fabio', senha: 'SenhaDoFabio#2026' });
  const painel = await requisitar(servidor, 'GET', '/api/operador/painel', null, { Authorization: `Bearer ${login.corpo.token}` });
  assert.equal(painel.status, 200);

  const texto = JSON.stringify(painel.corpo);
  assert.ok(!texto.includes(placa), 'placa completa não pode aparecer no painel do operador');
  assert.ok(painel.corpo.veiculos.some((v) => v.placa === '***9V87'));
});

test('RECURSO 4 - Mascaramento: log de erros não guarda senha nem placa completa', opcoesDeTeste, async (t) => {
  const servidor = await subirServidorDeTeste(criarApp);
  t.after(() => servidor.close());

  const senhaSecreta = 'SenhaQueNaoPodeVazarNoLog#99';
  const placaDoLog = 'LOG1K23';
  await requisitar(servidor, 'POST', '/api/operador/login', { usuario: 'ninguem', senha: senhaSecreta }); // erro 401 -> vai pro log
  await requisitar(servidor, 'POST', '/api/saida', { placa: placaDoLog }); // erro de validação -> vai pro log

  const log = fs.readFileSync(ARQUIVO_LOG, 'utf8');
  assert.ok(!log.includes(senhaSecreta), 'senha apareceu no log');
  assert.ok(!log.includes(placaDoLog), 'placa completa apareceu no log');
  assert.ok(log.includes('[OCULTO]'), 'esperava campo senha como [OCULTO]');
  assert.ok(log.includes('***1K23'), 'esperava placa mascarada no log');
});

test.after(async () => {
  if (!pronto) return;
  await limparTabelas(admin);
  await dbModulo.fecharConexoes();
  await admin.end();
});
