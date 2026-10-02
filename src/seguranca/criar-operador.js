/**
 * criar-operador.js
 * -----------------
 * Cadastra um operador no banco. A senha é pedida no terminal (não aparece
 * na tela e não fica no histórico de comandos) e é guardada só como hash bcrypt.
 *
 * Roda com a conexão de ADMINISTRADOR (ADMIN_DATABASE_URL), porque o usuário
 * restrito da aplicação (totem_app) não tem permissão de INSERT em "operadores"
 * (Recurso 3 - menor privilégio).
 *
 * Uso:  npm run operador:criar -- <usuario>
 */

const readline = require('readline');
const { criarPool } = require('../conexao');
const { criarOperador } = require('./operadores');
const config = require('../../config/config');

function perguntarSenha() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });
    rl.question('Senha do operador (8 a 72 caracteres): ', (resposta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(resposta);
    });
    // Troca o texto digitado por "*" (a pergunta acima já foi escrita normalmente).
    rl._writeToOutput = (texto) => rl.output.write(texto.includes('\n') ? texto : '*');
  });
}

(async () => {
  const usuario = process.argv[2];
  if (!usuario) {
    console.error('Uso: npm run operador:criar -- <usuario>');
    process.exit(1);
  }
  if (!config.banco.urlAdmin) {
    console.error('ADMIN_DATABASE_URL não definida no .env (conexão do usuário administrador do banco).');
    process.exit(1);
  }
  const conexaoAdmin = criarPool(config.banco.urlAdmin, { max: 1 });
  try {
    const senha = await perguntarSenha();
    await criarOperador(usuario, senha, conexaoAdmin);
    console.log(`Operador "${usuario}" criado. A senha foi guardada apenas como hash bcrypt.`);
  } catch (erro) {
    console.error(`Não foi possível criar o operador: ${erro.mensagemPublica || erro.message}`);
    process.exitCode = 1;
  } finally {
    await conexaoAdmin.end();
  }
})();
