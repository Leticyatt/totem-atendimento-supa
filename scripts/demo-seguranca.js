/**
 * demo-seguranca.js
 * -----------------
 * Mostra, no terminal, os recursos de segurança do armazenamento funcionando
 * no banco real. Pensado para a apresentação:  npm run demo:seguranca
 *
 * É SEGURO: cada tentativa roda dentro de uma transação que sempre termina em
 * ROLLBACK, então nada é alterado mesmo que o banco aceitasse o comando.
 */

const { criarPool } = require('../src/conexao');
const config = require('../config/config');

const linha = (t) => console.log(`\n=== ${t} ===`);

async function tentar(pool, rotulo, sql, deveSerPermitido = false) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(sql);
    console.log(
      deveSerPermitido
        ? `  ${rotulo.padEnd(34)} PERMITIDO (é o que a aplicação precisa)`
        : `  ${rotulo.padEnd(34)} EXECUTOU  <-- atenção: usuário com poder demais`
    );
  } catch (erro) {
    console.log(
      deveSerPermitido
        ? `  ${rotulo.padEnd(34)} FALHOU    (${erro.message})`
        : `  ${rotulo.padEnd(34)} RECUSADO  (${erro.message})`
    );
  } finally {
    await cliente.query('ROLLBACK').catch(() => {});
    cliente.release();
  }
}

(async () => {
  if (!config.banco.url) {
    console.error('Defina DATABASE_URL no .env.');
    process.exit(1);
  }
  const pool = criarPool(config.banco.url, { max: 1 });
  try {
    linha('RECURSO 3 - Menor privilégio: com quem o back-end está conectado?');
    const quem = await pool.query(
      `SELECT current_user AS usuario, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`
    );
    console.log('  ', quem.rows[0]);

    linha('RECURSO 3 - O que o usuário da aplicação consegue (e não consegue) fazer');
    await tentar(pool, 'SELECT em veiculos', 'SELECT COUNT(*) FROM veiculos', true);
    await tentar(pool, 'DELETE FROM veiculos', 'DELETE FROM veiculos');
    await tentar(pool, 'DROP TABLE veiculos', 'DROP TABLE veiculos');
    await tentar(pool, 'UPDATE tarifa (configuracao)', "UPDATE configuracao SET valor = '0' WHERE chave = 'valor_carro'");
    await tentar(pool, 'INSERT de operador', "INSERT INTO operadores (usuario, senha_hash) VALUES ('intruso', 'x')");
    await tentar(pool, 'CREATE ROLE', 'CREATE ROLE intruso LOGIN');

    linha('RECURSO 2 - Hashing: o que está guardado na coluna de senha');
    const ops = await pool.query('SELECT usuario, senha_hash FROM operadores ORDER BY id LIMIT 3');
    if (ops.rows.length === 0) console.log('  (nenhum operador: rode npm run operador:criar -- admin)');
    ops.rows.forEach((o) => console.log(`   ${o.usuario.padEnd(12)} ${o.senha_hash}`));

    linha('RECURSO 1 - Criptografia: a conexão com o banco está cifrada?');
    const ssl = await pool.query(
      `SELECT ssl, version AS tls, cipher FROM pg_stat_ssl WHERE pid = pg_backend_pid()`
    );
    console.log('  ', ssl.rows[0]);
    console.log('   (em trânsito: TLS. Em repouso: os discos do Supabase são cifrados pelo provedor.)');
  } catch (erro) {
    console.error('Falha na demonstração:', erro.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
