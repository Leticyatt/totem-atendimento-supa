/**
 * operadores.js
 * -------------
 * RECURSO 2 - HASHING DE SENHAS (bcrypt + salt)
 * ----------------------------------------------
 * Regra do slide: o banco NUNCA guarda senha em texto puro.
 *
 * O totem em si não tem login (quem usa é o cliente do estacionamento), mas
 * o painel interno do pátio é para o OPERADOR. Esse operador precisa de
 * usuário e senha, e é aqui que a senha entra no banco, já como hash.
 *
 * Como funciona:
 *   - bcrypt.hash(senha, custo) gera um SALT aleatório novo a cada chamada e
 *     mistura com a senha. Duas pessoas com a mesma senha acabam com hashes
 *     diferentes, e tabelas prontas de hashes (rainbow tables) não servem.
 *   - O resultado (ex.: "$2b$12$....") já carrega o custo e o salt, então a
 *     coluna senha_hash é tudo que precisamos guardar.
 *   - O hash não tem volta. Para conferir o login, bcrypt.compare refaz o
 *     cálculo com o salt guardado e compara.
 *   - "custo" 12 deixa cada tentativa deliberadamente lenta, o que atrapalha
 *     quem tenta adivinhar senhas em massa depois de um vazamento.
 *
 * RECURSO 3 (menor privilégio) aparece aqui também: o usuário do banco que o
 * servidor usa (totem_app) só tem SELECT em "operadores". Ou seja, o login
 * consegue LER o hash, mas a aplicação web não consegue cadastrar nem alterar
 * operador. O cadastro é feito pelo administrador, com a conexão de admin
 * (npm run operador:criar), por isso criarOperador recebe essa conexão.
 *
 * Usamos a biblioteca bcryptjs (bcrypt em JavaScript puro): mesmo algoritmo,
 * sem precisar compilar nada na instalação.
 */

const bcrypt = require('bcryptjs');
const { ErroDeValidacao } = require('../errors');
const config = require('../../config/config');

// Hash de mentira, usado quando o usuário não existe: assim a verificação
// leva o mesmo tempo com usuário certo ou errado (não revela quem existe).
const HASH_FALSO = bcrypt.hashSync('senha-que-nao-existe', config.seguranca.bcryptCusto);

const REGEX_USUARIO = /^[A-Za-z0-9._-]{3,32}$/;

/**
 * @param {string} usuario
 * @param {string} senha
 * @param {import('pg').Pool} conexaoAdmin conexão com permissão de INSERT em operadores
 */
async function criarOperador(usuario, senha, conexaoAdmin) {
  if (typeof usuario !== 'string' || !REGEX_USUARIO.test(usuario)) {
    throw new ErroDeValidacao('Usuário inválido. Use de 3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado.');
  }
  // bcrypt só considera os primeiros 72 bytes da senha, por isso o limite.
  if (typeof senha !== 'string' || senha.length < 8 || Buffer.byteLength(senha, 'utf8') > 72) {
    throw new ErroDeValidacao('Senha inválida. Use de 8 a 72 caracteres.');
  }
  if (!conexaoAdmin) {
    throw new Error('criarOperador exige a conexão de administrador (ADMIN_DATABASE_URL).');
  }

  const existente = await conexaoAdmin.query(`SELECT 1 FROM operadores WHERE usuario = $1`, [usuario]);
  if (existente.rowCount > 0) {
    throw new ErroDeValidacao('Já existe um operador com esse usuário.');
  }
  const senhaHash = await bcrypt.hash(senha, config.seguranca.bcryptCusto);
  // Query parametrizada (Pilar 1), como todas as outras.
  await conexaoAdmin.query(`INSERT INTO operadores (usuario, senha_hash) VALUES ($1, $2)`, [usuario, senhaHash]);
}

/** @returns {Promise<{id:number, usuario:string}|null>} o operador, ou null se usuário/senha não conferem */
async function verificarCredenciais(usuario, senha) {
  // require "preguiçoso": o script de cadastro (admin) importa este arquivo e
  // não precisa da conexão restrita da aplicação (DATABASE_URL).
  const { stmts } = require('../db');
  const linha = typeof usuario === 'string' ? await stmts.buscarOperadorPorUsuario.get(usuario) : null;
  const senhaTexto = typeof senha === 'string' ? senha : '';
  const confere = await bcrypt.compare(senhaTexto, linha ? linha.senha_hash : HASH_FALSO);
  return linha && confere ? { id: linha.id, usuario: linha.usuario } : null;
}

module.exports = { criarOperador, verificarCredenciais };
