/**
 * routes/operador.js
 * ------------------
 * Área interna do operador do pátio. Reúne, na prática, os recursos de
 * segurança de armazenamento:
 *   - login confere a senha contra o HASH bcrypt guardado (Recurso 2);
 *   - o painel só abre com token válido e mostra PLACAS MASCARADAS (Recurso 4);
 *   - o back-end acessa o banco com um usuário restrito, sem poder de admin (Recurso 3);
 *   - o banco fica em um servidor com criptografia em repouso (Recurso 1).
 *
 * As rotas do totem (src/routes/estacionamento.js) não foram alteradas.
 */

const express = require('express');
const { stmts } = require('../db');
const { asyncHandler } = require('../middleware/errorHandler');
const { autenticar, exigirOperador } = require('../seguranca/autenticacao');
const { mascararPlaca } = require('../seguranca/mascaramento');
const demoSeguranca = require('./seguranca-demo');

const router = express.Router();

// POST /api/operador/login  { usuario, senha }  ->  { token, expiraEm }
router.post('/login', asyncHandler(async (req, res) => {
  const { usuario, senha } = req.body || {};
  const sessao = await autenticar(usuario, senha, req.ip);
  return res.status(200).json({ sucesso: true, ...sessao });
}));

// GET /api/operador/painel  (Authorization: Bearer <token>)
// Mesma informação de /api/painel, só que com a placa mascarada.
router.get('/painel', exigirOperador, asyncHandler(async (req, res) => {
  const veiculos = (await stmts.listarVeiculosDentro.all()).map((v) => ({
    ...v,
    placa: mascararPlaca(v.placa),
  }));
  return res.status(200).json({ sucesso: true, operador: req.operador, veiculos });
}));

// Situação da camada de dados (faixa do painel). Partes de demonstração: DEMO_SEGURANCA=false.
router.use('/seguranca', exigirOperador, demoSeguranca);

module.exports = router;
