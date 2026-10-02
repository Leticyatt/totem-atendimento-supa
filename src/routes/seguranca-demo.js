/**
 * routes/seguranca-demo.js
 * ------------------------
 * Rotas de DEMONSTRAÇÃO dos 4 recursos de segurança do slide, usadas pela tela
 * /seguranca. Todas ficam atrás do login do operador (exigirOperador).
 *
 * Para desligar depois da apresentação: DEMO_SEGURANCA=false no Render.
 *
 * Cuidado de segurança: nenhuma rota aqui executa SQL vindo do cliente. O teste
 * do Recurso 3 usa uma lista FIXA de comandos, roda dentro de uma transação que
 * sempre termina em ROLLBACK, e só roda se o back-end NÃO for administrador.
 */

const express = require('express');
const { pool, stmts, verificarPrivilegios } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { ErroDeAplicacao } = require('../errors');
const { mascararPlaca } = require('../seguranca/mascaramento');
const config = require('../../config/config');

const router = express.Router();

// Recurso 1 - a conexão do back-end com o banco está cifrada (TLS)?
router.get('/recurso1', asyncHandler(async (req, res) => {
  let host = '';
  try { host = new URL(config.banco.url).hostname; } catch { /* sem host */ }
  const cliente = await pool.connect();
  let tls = { cifrada: false, protocolo: null, cifra: null };
  try {
    const s = cliente.connection && cliente.connection.stream;
    if (s && s.encrypted) {
      const c = s.getCipher ? s.getCipher() : null;
      tls = { cifrada: true, protocolo: s.getProtocol(), cifra: c ? c.name : null };
    }
  } finally {
    cliente.release();
  }
  res.json({ sucesso: true, host, ...tls });
}));

// Recurso 2 - o que realmente está guardado no banco para o operador logado.
router.get('/recurso2', asyncHandler(async (req, res) => {
  const op = await stmts.buscarOperadorPorUsuario.get(req.operador);
  if (!op) throw new ErroDeAplicacao('Operador não encontrado.', 404);
  // Formato bcrypt: $2b$12$<22 chars de salt><31 chars de hash>
  const m = /^\$(2[abxy])\$(\d{2})\$(.{22})(.{31})$/.exec(op.senha_hash);
  res.json({
    sucesso: true,
    usuario: op.usuario,
    senhaHash: op.senha_hash,
    partes: m ? { versao: m[1], custo: Number(m[2]), salt: m[3], hash: m[4] } : null,
  });
}));

// Recurso 3 - com quem o back-end está conectado e o que essa conta pode fazer.
router.get('/recurso3', asyncHandler(async (req, res) => {
  const priv = await verificarPrivilegios();
  const { rows } = await pool.query(
    `SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee = current_user AND table_schema = 'public' ORDER BY 1, 2`
  );
  const permissoes = {};
  for (const r of rows) (permissoes[r.table_name] ||= []).push(r.privilege_type);
  res.json({ sucesso: true, ...priv, permissoes });
}));

// Lista FIXA: o cliente só escolhe o id, nunca o SQL.
const TENTATIVAS = {
  drop: { rotulo: 'DROP TABLE veiculos', sql: 'DROP TABLE veiculos' },
  delete: { rotulo: 'DELETE FROM veiculos', sql: 'DELETE FROM veiculos' },
  tarifa: {
    rotulo: "UPDATE configuracao SET valor = '0' (tarifa do carro)",
    sql: "UPDATE configuracao SET valor = '0' WHERE chave = 'valor_carro'",
  },
  operador: {
    rotulo: "INSERT INTO operadores (cadastrar operador)",
    sql: "INSERT INTO operadores (usuario, senha_hash) VALUES ('intruso', 'x')",
  },
};

router.post('/recurso3/tentar', asyncHandler(async (req, res) => {
  const t = TENTATIVAS[req.body && req.body.acao];
  if (!t) throw new ErroDeAplicacao('Ação desconhecida.', 400);

  const priv = await verificarPrivilegios();
  if (priv.administrador) {
    throw new ErroDeAplicacao('Teste bloqueado: o back-end está conectado como administrador.', 409);
  }

  const cliente = await pool.connect();
  let resultado;
  try {
    await cliente.query('BEGIN');
    try {
      await cliente.query(t.sql);
      resultado = { permitido: true, mensagem: 'O banco executou o comando (desfeito em seguida).' };
    } catch (e) {
      resultado = { permitido: false, mensagem: e.message };
    }
  } finally {
    try { await cliente.query('ROLLBACK'); } catch { /* conexão já encerrada */ }
    cliente.release();
  }
  res.json({ sucesso: true, usuario: priv.usuario, comando: t.rotulo, ...resultado });
}));

// Recurso 4 - dado original x dado mascarado.
router.get('/recurso4', asyncHandler(async (req, res) => {
  const lista = (await stmts.listarVeiculosDentro.all()).slice(0, 8);
  res.json({
    sucesso: true,
    veiculos: lista.map((v) => ({ ticket: v.ticket, original: v.placa, mascarada: mascararPlaca(v.placa) })),
  });
}));

module.exports = router;
