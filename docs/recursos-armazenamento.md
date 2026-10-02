# Recursos de segurança no armazenamento (camada de dados)

Complemento dos três pilares: aqui estão os 4 recursos do slide *Recursos de
Segurança no Armazenamento*, aplicados ao totem com **PostgreSQL hospedado no Supabase**.

| # | Recurso do slide | Como ficou no projeto |
|---|---|---|
| 1 | Criptografia em repouso | Discos do banco cifrados pelo Supabase; conexão cifrada com TLS/SSL |
| 2 | Hashing de senhas (bcrypt + salt) | Login de **operador**; a senha só existe no banco como hash bcrypt |
| 3 | Princípio do menor privilégio | O back-end conecta como `totem_app`, usuário restrito (não é administrador) |
| 4 | Mascaramento de dados | Painel do operador e logs mostram a placa como `***1D23` |

---

## 1) Criptografia em repouso (Data at Rest)

**Problema:** se alguém copiar os arquivos físicos do banco, não pode conseguir ler os dados.

**Como está:** o banco agora é um servidor gerenciado (Supabase), e a criptografia dos discos
é feita pelo provedor — por isso o servidor do banco, e não a minha aplicação, guarda a chave.
Além disso, a conexão entre o totem e o banco é **cifrada em trânsito** (SSL/TLS): o código
(`src/conexao.js`) exige SSL sempre que o banco não é `localhost`.

- Demonstração: `npm run demo:seguranca` mostra, na seção do Recurso 1, que a conexão está
  usando TLS (`ssl: true`, versão e cifra).
- Para a fala: "em repouso, quem cifra os discos é o provedor; em trânsito, a aplicação
  força TLS; e a aplicação nunca guarda senha em texto puro (Recurso 2)".

**Limitação (para dizer com honestidade):** essa cifra protege o disco, não protege contra
quem tem acesso lógico ao banco. Se fosse preciso proteger a placa também contra o próprio
provedor/administrador do banco, o passo seguinte seria cifrar a coluna `placa` na
aplicação (criptografia de coluna, com AES-GCM e um índice cego para buscar).

## 2) Hashing de senhas (bcrypt + salt)

O totem não tinha nenhuma senha guardada, então criei onde ela faz sentido: o painel interno
do pátio, para o **operador**.

- Tabela `operadores (usuario, senha_hash)`, criada em `db/schema.sql`.
- `bcrypt.hash(senha, 12)` gera um salt aleatório a cada senha. Duas pessoas com a mesma senha
  ficam com hashes diferentes (o teste confere isso).
- Login: `POST /api/operador/login` compara a senha digitada com o hash (`bcrypt.compare`).
  Usuário inexistente e senha errada recebem exatamente a mesma resposta, e a verificação leva
  o mesmo tempo nos dois casos.
- Depois de 5 senhas erradas seguidas (mesmo IP e usuário) o login bloqueia por 60 s (`429`).
- Cadastro: `npm run operador:criar -- admin` (senha pedida no terminal, não fica no histórico).
- Biblioteca `bcryptjs` (mesmo algoritmo bcrypt, em JavaScript puro).

## 3) Princípio do menor privilégio

O slide diz: o back-end **não deve** conectar ao banco com o usuário Administrador (Root);
deve ter um usuário restrito que só executa as ações necessárias.

Agora isso é feito do jeito "de verdade", com um usuário do PostgreSQL (`db/schema.sql`):

| Tabela | `totem_app` pode | Por quê |
|---|---|---|
| `veiculos` | `SELECT`, `INSERT`, `UPDATE` | registrar entrada e saída |
| `configuracao` | `SELECT` | só lê tarifas e vagas; quem altera é o admin |
| `operadores` | `SELECT` | o login só lê o hash; quem cadastra operador é o admin |

Ele **não** pode: `DELETE`, `DROP`, `TRUNCATE`, criar tabelas, criar usuários, nem alterar tarifas.
Se um ataque (ou um bug) tentar `DROP TABLE veiculos` por esse caminho, o próprio banco recusa:
`must be owner of table veiculos`.

Três camadas reforçam isso:

1. **GRANT mínimo** (acima), no `db/schema.sql`.
2. **RLS (Row Level Security)** ligado nas três tabelas: no Supabase as tabelas do schema `public`
   também ficam expostas por uma API pública; sem política para esses papéis, ela enxerga zero linhas.
3. **O servidor confere com quem está conectado** (`verificarPrivilegios()` em `src/db.js`): com
   `NODE_ENV=production`, se a `DATABASE_URL` for de um administrador, o servidor **recusa subir**.

Separação das credenciais: o administrador (`ADMIN_DATABASE_URL`) só existe no `.env` do seu PC,
para `db:setup` e `operador:criar`. O servidor publicado só conhece a `DATABASE_URL` do `totem_app`.

## 4) Mascaramento de dados (Data Masking)

O dado sensível aqui é a placa. A regra segue o exemplo do slide (últimos 4 caracteres visíveis):
`ABC1D23` vira `***1D23` (`src/seguranca/mascaramento.js`).

- `GET /api/operador/painel` (exige login): lista do pátio com a placa mascarada.
- `src/logger.js`: o `logs/erros.log` guarda a placa mascarada e **nunca** senha ou token
  (campo vira `[OCULTO]`).

---

## Demonstração para a apresentação

Um comando mostra os recursos 1, 2 e 3 funcionando no banco real do Supabase:

```bash
npm run demo:seguranca
```

Ele roda tudo dentro de transações com `ROLLBACK` (nada é alterado) e imprime:
com quem o back-end está conectado, as tentativas de `DELETE`/`DROP`/`UPDATE` recusadas pelo
banco, o hash bcrypt guardado no lugar da senha e se a conexão está cifrada.

Recurso 4 (mascaramento + login), em Git Bash (no PowerShell use `curl.exe`):

```bash
# sem login: negado (401)
curl -s https://SEU-APP.onrender.com/api/operador/painel

# login (guarde o token da resposta)
curl -s -X POST https://SEU-APP.onrender.com/api/operador/login \
  -H "Content-Type: application/json" -d '{"usuario":"admin","senha":"SUA_SENHA"}'

# painel com token: placas como ***1D23
curl -s https://SEU-APP.onrender.com/api/operador/painel -H "Authorization: Bearer COLE_O_TOKEN"
```

No painel do Supabase (Table Editor, tabela `operadores`) também dá para mostrar o `senha_hash`.

## Testes automatizados

`npm test` roda 16 testes (3 pilares + 4 recursos + integridade das vagas). Eles usam um banco
**só de teste** (local ou um segundo projeto) e **apagam** `veiculos` e `operadores` dele.
Configure no `.env`:

```env
TEST_DATABASE_URL=...        # usuário totem_app do banco de teste
TEST_ADMIN_DATABASE_URL=...  # administrador do banco de teste
```

Prepare o banco de teste com `npm run db:setup` apontando `ADMIN_DATABASE_URL` para ele.
Sem essas variáveis os testes que dependem do banco são pulados. Por segurança, os testes se
recusam a rodar se a URL de teste for igual à de produção.

## O que mudou em relação à versão com SQLite

| Antes (SQLite) | Agora (PostgreSQL / Supabase) |
|---|---|
| Arquivo `estacionamento.db` local | Banco em servidor (Supabase) |
| Criptografia: SQLCipher, chave `TOTEM_DB_KEY` | Criptografia do provedor + TLS na conexão |
| Menor privilégio: conexão `readonly` | Usuário `totem_app` com `GRANT` mínimo + RLS |
| Prepared statements `?` | Queries parametrizadas `$1, $2` |
| Consultas síncronas | Consultas assíncronas (`await`) |
| Tabelas criadas pelo app | Tabelas criadas por `db/schema.sql` (admin) |
| Conferir vaga e inserir em passos separados | Mesma transação + trava por tipo (sem estourar vagas em acessos simultâneos) |
| Datas `YYYY-MM-DD HH:MM:SS` (texto) | `timestamptz` (ISO), com fuso correto |
