/**
 * routes/estacionamento.js
 * ------------------------
 * Rotas do totem de estacionamento. Cada rota:
 *  - usa as queries parametrizadas de db.js, ja encapsuladas contra falha
 *    de infraestrutura (Pilar 1 + parte de infraestrutura do Pilar 2)
 *  - lanca erros tipados que o errorHandler traduz com seguranca (Pilar 2)
 *  - fica atras do rate limiter (Pilar 3), aplicado so nas rotas de
 *    ESCRITA (/entrada e /saida) - e ali que faz sentido conter alguem
 *    "apertando" a mesma acao repetidas vezes. As rotas de leitura
 *    (/vagas, /tarifas, /painel) ficam de fora, pois sao consultadas
 *    automaticamente pelo front (painel de vagas, tabela de tarifas)
 *    e nao representam abuso.
 *
 * OBS: as chamadas a stmts.*.get/.run/.all ja lancam ErroDeBancoDeDados
 * automaticamente se o Postgres falhar (rede fora, banco pausado, timeout
 * etc.) - nao e preciso envolver cada chamada em try/catch aqui, o
 * encapsulamento fica centralizado em db.js. Como o banco agora e um servidor
 * remoto, todas as chamadas sao assincronas (await).
 */

const express = require('express');
const {
  stmts,
  registrarEntradaSeHouverVaga,
  tipoValido,
  getConfigNumero,
  gerarTicket,
  TIPOS_VALIDOS,
} = require('../db');
const { ErroDeValidacao } = require('../errors');
const { asyncHandler } = require('../middleware/errorHandler');
const { criarRateLimiter } = require('../middleware/rateLimiter');
const config = require('../../config/config');

const router = express.Router();

// PILAR 3: limitador aplicado apenas nas rotas de escrita (entrada/saida),
// que sao as sensiveis a "aperta 500 milhoes de vezes" do enunciado.
const limitadorEscrita = criarRateLimiter(config.rateLimiter);

// Regex simples de validacao de placa (padrao antigo ABC1234 ou Mercosul ABC1D23).
const REGEX_PLACA = /^[A-Za-z]{3}[0-9][A-Za-z0-9][0-9]{2}$/;

function normalizarPlaca(placa) {
  if (placa === undefined || placa === null || placa === '') return null;
  return String(placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// POST /api/entrada -> veiculo chega, totem imprime ticket
router.post('/entrada', limitadorEscrita, asyncHandler(async (req, res) => {
  const { placa, tipo } = req.body || {};
  const tipoFinal = tipo || 'carro';

  if (!tipoValido(tipoFinal)) {
    throw new ErroDeValidacao(`Tipo de veículo inválido. Opções: ${TIPOS_VALIDOS.join(', ')}.`);
  }

  const placaNormalizada = normalizarPlaca(placa);
  if (placaNormalizada && !REGEX_PLACA.test(placaNormalizada)) {
    throw new ErroDeValidacao('Placa inválida. Use o formato ABC1234 ou ABC1D23.');
  }

  // Confere a vaga e grava a entrada numa unica transacao (ver db.js).
  const registro = await registrarEntradaSeHouverVaga(gerarTicket(), placaNormalizada, tipoFinal);
  if (!registro) {
    // 409 Conflict: nao ha vaga disponivel nessa area especifica (carro/moto)
    // - estado do recurso impede a operacao.
    return res.status(409).json({
      sucesso: false,
      erro: `Vagas de ${tipoFinal} lotadas no momento. Aguarde uma vaga ficar disponível.`,
    });
  }
  return res.status(201).json({ sucesso: true, ticket: registro });
}));

// POST /api/saida -> calcula valor a pagar e libera a vaga
router.post('/saida', limitadorEscrita, asyncHandler(async (req, res) => {
  const { ticket, placa } = req.body || {};

  if (!ticket && !placa) {
    throw new ErroDeValidacao('Informe o código do ticket ou a placa do veículo.');
  }

  let registro;
  if (ticket) {
    registro = await stmts.buscarPorTicket.get(String(ticket).trim());
  } else {
    registro = await stmts.buscarDentroPorPlaca.get(normalizarPlaca(placa));
  }

  if (!registro) {
    throw new ErroDeValidacao('Ticket ou placa não encontrado(a).');
  }
  if (registro.status !== 'dentro') {
    throw new ErroDeValidacao('Este veículo já registrou saída anteriormente.');
  }

  // Tarifa FIXA por tipo de veículo — sem cobrança por hora, sem
  // tolerância, sem teto de diária. O carro paga um valor fechado e a
  // moto paga um valor fechado mais barato (área exclusiva pra moto).
  const valor = await getConfigNumero(`valor_${registro.tipo}`);
  if (valor === null) {
    throw new ErroDeValidacao('Tarifa não configurada para este tipo de veículo.');
  }

  const entradaMs = new Date(registro.entrada).getTime(); // timestamptz chega como Date
  const agoraMs = Date.now();
  const minutosPermanencia = Math.max(0, Math.round((agoraMs - entradaMs) / 60000));

  await stmts.registrarSaida.run(valor, registro.id);

  // Busca o registro já atualizado (com a saida gravada) para devolver
  // um resumo completo — usado inclusive para a nota fiscal no totem.
  const registroAtualizado = await stmts.buscarPorTicket.get(registro.ticket);

  return res.status(200).json({
    sucesso: true,
    resumo: {
      ticket: registroAtualizado.ticket,
      placa: registroAtualizado.placa,
      tipo: registroAtualizado.tipo,
      entrada: registroAtualizado.entrada,
      saida: registroAtualizado.saida,
      minutosPermanencia,
      valor,
    },
  });
}));

// GET /api/ticket/:codigo -> consulta um ticket (parametro de rota via
// query parametrizada - exemplo direto do Pilar 1)
router.get('/ticket/:codigo', asyncHandler(async (req, res) => {
  const { codigo } = req.params;
  const registro = await stmts.buscarPorTicket.get(codigo);
  if (!registro) {
    throw new ErroDeValidacao('Ticket não encontrado.');
  }
  return res.status(200).json({ sucesso: true, ticket: registro });
}));

// GET /api/vagas -> ocupação atual do pátio, separada por tipo (a área de
// moto é isolada da área de carro, com capacidades independentes)
router.get('/vagas', asyncHandler(async (req, res) => {
  const montarBloco = async (tipo) => {
    const totais = await getConfigNumero(`vagas_totais_${tipo}`);
    const { total: ocupadas } = await stmts.contarVeiculosDentroPorTipo.get(tipo);
    return { totais, ocupadas, livres: Math.max(0, totais - ocupadas) };
  };

  const [carro, moto] = await Promise.all([montarBloco('carro'), montarBloco('moto')]);
  return res.status(200).json({ sucesso: true, vagas: { carro, moto } });
}));

// GET /api/tarifas -> tabela de preços vigente (exibida no totem)
router.get('/tarifas', asyncHandler(async (req, res) => {
  const [carro, moto] = await Promise.all([getConfigNumero('valor_carro'), getConfigNumero('valor_moto')]);
  return res.status(200).json({ sucesso: true, tarifas: { carro, moto } });
}));

// GET /api/painel -> lista de veículos atualmente no pátio (uso interno /
// operador, útil para demonstrar o sistema na apresentação)
router.get('/painel', asyncHandler(async (req, res) => {
  const veiculos = await stmts.listarVeiculosDentro.all();
  return res.status(200).json({ sucesso: true, veiculos });
}));

module.exports = router;