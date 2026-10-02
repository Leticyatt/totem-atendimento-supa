/**
 * mascaramento.js
 * ---------------
 * RECURSO 4 - MASCARAMENTO DE DADOS (Data Masking)
 * -------------------------------------------------
 * Ideia do slide: quem não precisa ver o dado completo não deve vê-lo.
 * No slide o exemplo é o cartão de crédito (só os 4 últimos dígitos).
 * Aqui o dado sensível é a PLACA do veículo, então seguimos a mesma
 * regra: só os 4 últimos caracteres aparecem.
 *
 *   ABC1D23  ->  ***1D23
 *
 * Onde é usado:
 *   - rota do operador (src/routes/operador.js): o painel mostra placas mascaradas;
 *   - logger (src/logger.js): o log que o desenvolvedor lê não guarda a placa
 *     completa, e nunca guarda senha ou token.
 */

const VISIVEIS = 4;
const CAMPOS_SECRETOS = ['senha', 'password', 'token', 'senha_hash'];

function mascararPlaca(placa) {
  if (placa === undefined || placa === null || placa === '') return placa ?? null;
  const texto = String(placa);
  if (texto.length <= VISIVEIS) return '*'.repeat(texto.length);
  return '*'.repeat(texto.length - VISIVEIS) + texto.slice(-VISIVEIS);
}

/**
 * Recebe o "extra" que o logger grava (ex.: { ip, body }) e devolve uma
 * CÓPIA com o corpo da requisição sanitizado. O objeto original não é
 * alterado (a rota continua enxergando o body normal).
 */
function sanitizarExtraParaLog(extra) {
  if (!extra || typeof extra !== 'object') return extra;
  const copia = { ...extra };
  const body = copia.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const bodySeguro = { ...body };
    for (const chave of Object.keys(bodySeguro)) {
      const nome = chave.toLowerCase();
      if (CAMPOS_SECRETOS.includes(nome)) {
        bodySeguro[chave] = '[OCULTO]';
      } else if (nome === 'placa') {
        bodySeguro[chave] = mascararPlaca(bodySeguro[chave]);
      }
    }
    copia.body = bodySeguro;
  }
  return copia;
}

module.exports = { mascararPlaca, sanitizarExtraParaLog };
