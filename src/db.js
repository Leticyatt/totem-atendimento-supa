/**
 * db.js
 * -----
 * Camada de acesso ao banco de dados do Totem de Autoatendimento para
 * Estacionamento (PostgreSQL, hospedado no Supabase).
 *
 * PILAR 1 - PREVENCAO DE SQL INJECTION
 * -------------------------------------
 * Toda consulta aqui usa QUERIES PARAMETRIZADAS ($1, $2, ...). O texto
 * digitado/lido pelo usuario (placa do veiculo, codigo do ticket) NUNCA e
 * concatenado diretamente na string SQL: o comando segue para o servidor
 * separado dos valores, que entram sempre como dado puro.
 *
 * Errado (NUNCA fazer):
 *   pool.query(`SELECT * FROM veiculos WHERE placa = '${placa}'`)
 *
 * Certo (o que fazemos aqui):
 *   pool.query('SELECT * FROM veiculos WHERE placa = $1', [placa])
 *
 * PILAR 2 (parte de infraestrutura) - ENCAPSULAMENTO DE ERROS DE BANCO
 * ----------------------------------------------------------------------
 * Qualquer chamada .get/.run/.all passa por "encapsular()", que converte
 * falhas reais do Postgres (rede fora do ar, banco pausado, timeout - o
 * equivalente a "queda de energia/rede" do enunciado) em
 * ErroDeBancoDeDados. Assim TODAS as rotas ficam protegidas
 * automaticamente, sem repetir try/catch em cada uma.
 *
 * RECURSO 3 - MENOR PRIVILEGIO
 * ----------------------------
 * Esta conexao usa DATABASE_URL, que deve apontar para o usuario restrito
 * "totem_app" (veja db/schema.sql) e NUNCA para o administrador. Ao subir,
 * o servidor confere isso com verificarPrivilegios().
 */

const { criarPool } = require('./conexao');
const { ErroDeBancoDeDados } = require('./errors');
const { logErro } = require('./logger');
const config = require('../config/config');

if (!config.banco.url) {
  throw new Error(
    'DATABASE_URL não definida. Copie .env.example para .env e preencha a conexão do banco (veja o README).'
  );
}

const pool = criarPool(config.banco.url);

// Erro em conexão ociosa do pool (ex.: o banco reiniciou). Sem este listener
// o Node derrubaria o processo inteiro.
pool.on('error', (erro) => logErro('pool do banco (conexão ociosa)', erro));

const TIPOS_VALIDOS = ['carro', 'moto'];

/**
 * Transforma um SQL parametrizado em um objeto com .get / .run / .all.
 * Qualquer erro do driver vira ErroDeBancoDeDados (503), com o detalhe
 * tecnico original preservado so para o log do servidor.
 */
function encapsular(sql) {
  const executar = async (params) => {
    try {
      return await pool.query(sql, params);
    } catch (erroBanco) {
      throw new ErroDeBancoDeDados(erroBanco.message);
    }
  };
  return {
    get: async (...params) => (await executar(params)).rows[0],
    run: async (...params) => ({ changes: (await executar(params)).rowCount }),
    all: async (...params) => (await executar(params)).rows,
  };
}

// Todas as instrucoes abaixo usam parametros ($n) e sao encapsuladas para
// tratar falha de infraestrutura de forma automatica e consistente.
const stmts = {
  buscarPorTicket: encapsular(`SELECT * FROM veiculos WHERE ticket = $1`),
  buscarDentroPorPlaca: encapsular(
    `SELECT * FROM veiculos WHERE placa = $1 AND status = 'dentro' ORDER BY id DESC LIMIT 1`
  ),
  registrarSaida: encapsular(
    `UPDATE veiculos SET status = 'saiu', saida = now(), valor_pago = $1 WHERE id = $2`
  ),
  contarVeiculosDentroPorTipo: encapsular(
    `SELECT COUNT(*)::int AS total FROM veiculos WHERE status = 'dentro' AND tipo = $1`
  ),
  listarVeiculosDentro: encapsular(
    `SELECT * FROM veiculos WHERE status = 'dentro' ORDER BY entrada ASC`
  ),
  buscarConfig: encapsular(`SELECT valor FROM configuracao WHERE chave = $1`),
  buscarOperadorPorUsuario: encapsular(
    `SELECT id, usuario, senha_hash FROM operadores WHERE usuario = $1`
  ),
};

/**
 * Registra a entrada SOMENTE se ainda houver vaga na area do tipo.
 * Conferir a vaga e inserir precisam acontecer juntos: com varias
 * requisicoes simultaneas (agora o banco e um servidor, nao um arquivo
 * local), duas poderiam ler "ainda tem 1 vaga" ao mesmo tempo e lotar
 * alem do limite. Por isso: transacao + trava (advisory lock) por tipo.
 *
 * @returns {Promise<object|null>} o registro criado, ou null se lotado.
 */
async function registrarEntradaSeHouverVaga(ticket, placa, tipo) {
  let cliente;
  try {
    cliente = await pool.connect();
    await cliente.query('BEGIN');
    await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`vagas:${tipo}`]);

    const cfg = await cliente.query(`SELECT valor FROM configuracao WHERE chave = $1`, [
      `vagas_totais_${tipo}`,
    ]);
    const vagasTotais = cfg.rows[0] ? Number(cfg.rows[0].valor) : NaN;
    if (!Number.isFinite(vagasTotais)) {
      throw new Error(`configuracao vagas_totais_${tipo} ausente`);
    }

    const contagem = await cliente.query(
      `SELECT COUNT(*)::int AS total FROM veiculos WHERE status = 'dentro' AND tipo = $1`,
      [tipo]
    );
    if (contagem.rows[0].total >= vagasTotais) {
      await cliente.query('ROLLBACK');
      return null;
    }

    const inserido = await cliente.query(
      `INSERT INTO veiculos (ticket, placa, tipo) VALUES ($1, $2, $3) RETURNING *`,
      [ticket, placa, tipo]
    );
    await cliente.query('COMMIT');
    return inserido.rows[0];
  } catch (erroBanco) {
    try {
      if (cliente) await cliente.query('ROLLBACK');
    } catch {
      /* conexão já perdida: nada a desfazer */
    }
    throw new ErroDeBancoDeDados(erroBanco.message);
  } finally {
    if (cliente) cliente.release();
  }
}

function tipoValido(tipo) {
  return TIPOS_VALIDOS.includes(tipo);
}

async function getConfigNumero(chave) {
  const linha = await stmts.buscarConfig.get(chave);
  return linha ? Number(linha.valor) : null;
}

function gerarTicket() {
  // Codigo curto e legivel para impressao no totem: T + timestamp base36 + aleatorio
  const agora = Date.now().toString(36).toUpperCase();
  const aleatorio = Math.floor(Math.random() * 36 ** 3).toString(36).toUpperCase().padStart(3, '0');
  return `T-${agora}-${aleatorio}`;
}

/** Testa se o banco responde (usado pelo /api/health). Lança ErroDeBancoDeDados se falhar. */
async function verificarConexao() {
  try {
    await pool.query('SELECT 1');
  } catch (erroBanco) {
    throw new ErroDeBancoDeDados(erroBanco.message);
  }
}

/**
 * RECURSO 3 - confere com que usuario do banco o back-end esta conectado.
 * "administrador" = superusuario, ou com poder de criar bancos/usuarios,
 * ou que ignora o RLS, ou o usuario padrao "postgres".
 */
async function verificarPrivilegios() {
  const { rows } = await pool.query(
    `SELECT current_user AS usuario, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`
  );
  const r = rows[0];
  const administrador =
    r.rolsuper || r.rolcreaterole || r.rolcreatedb || r.rolbypassrls || r.usuario === 'postgres';
  return { usuario: r.usuario, administrador: Boolean(administrador) };
}

async function fecharConexoes() {
  await pool.end();
}

module.exports = {
  pool,
  encapsular,
  stmts,
  registrarEntradaSeHouverVaga,
  TIPOS_VALIDOS,
  tipoValido,
  getConfigNumero,
  gerarTicket,
  verificarConexao,
  verificarPrivilegios,
  fecharConexoes,
};
