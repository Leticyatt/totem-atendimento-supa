# Totem de Autoatendimento para Estacionamento
### Trabalho de Segurança de Sistemas da Informação

## O que é

Um totem de autoatendimento de estacionamento é um sistema com contato direto com
um grande volume de usuários: carros chegando e saindo o dia inteiro, gente
apertando botão sem parar, e um backend que precisa aguentar isso sem cair e
sem vazar informação sensível se alguma coisa der errado.

Este projeto implementa o backend desse totem (entrada de veículo, saída com
cálculo de valor, consulta de ticket, contagem de vagas, painel de veículos no
pátio) e nele os **três pilares de segurança** pedidos: prevenção de SQL
Injection, gestão de erros do lado do servidor e rate limiting. A interface
web (`assets/index.html`) foi desenhada com uma paleta clean — fundo claro,
azul como cor de marca — inspirada em totens reais de autopagamento de
estacionamento (ex.: linha de totens da CloudPark).

## Vagas e tarifas (configuráveis em `config/config.js`)

| Item | Valor padrão |
|---|---|
| Vagas — área de carro | 50 |
| Vagas — área de moto | 10 |
| Tarifa fixa — Carro | R$ 13,00 |
| Tarifa fixa — Moto | R$ 10,00 |

O pátio tem **duas áreas independentes**: uma pra carro e outra, menor, só
pra moto — cada uma com sua própria capacidade. Um carro nunca ocupa vaga de
moto e vice-versa; quando a área de um tipo lota, o totem recusa a entrada
*apenas* daquele tipo (`409` com a mensagem "Vagas de carro/moto lotadas"),
mesmo que a outra área ainda tenha espaço sobrando.

A cobrança é **fixa por tipo de veículo**, sem cálculo por hora, tolerância ou
teto de diária: carro paga um valor fechado e moto paga um valor fechado mais
barato (reflexo da área exclusiva). Para mudar qualquer um desses valores,
altere as linhas da tabela `configuracao` no banco (como administrador, no
SQL Editor do Supabase), por exemplo:
`UPDATE configuracao SET valor = '15.00' WHERE chave = 'valor_carro';`
(o usuário da aplicação não tem permissão de alterar tarifas, de propósito).

## Como rodar

O banco é um **PostgreSQL** (hospedado no Supabase) e a aplicação é um servidor Node.
Passo a passo completo, inclusive para publicar na internet (Supabase + Render):
[`docs/deploy-supabase-render.md`](docs/deploy-supabase-render.md). Resumo:

```bash
npm install
cp .env.example .env              # preencha DATABASE_URL, ADMIN_DATABASE_URL e APP_DB_PASSWORD
npm run db:setup                  # cria tabelas, usuário restrito "totem_app", permissões e RLS
npm run operador:criar -- admin   # cadastra o operador do painel
npm start
# abre http://localhost:3000
```

O totem web fica em `assets/index.html` (abas de Entrada / Saída). A API fica
em `/api/*`. Testes automatizados: `npm test` (precisa de um banco de teste, ver
[`docs/recursos-armazenamento.md`](docs/recursos-armazenamento.md)).
Demonstração dos recursos de segurança no terminal: `npm run demo:seguranca`.

## Estrutura

```
config/config.js                -> configurações centralizadas (tarifas, vagas, rate limit, porta)
src/app.js                      -> monta a aplicação (rotas + os 3 pilares), exportada p/ testes
src/server.js                   -> ponto de entrada, só sobe o servidor HTTP
src/db.js                       -> banco (PostgreSQL) e QUERIES PARAMETRIZADAS
src/conexao.js                  -> pool de conexões (SSL, tipos numéricos)
db/schema.sql                   -> tabelas, usuário restrito totem_app (menor privilégio) e RLS
scripts/setup-db.js             -> aplica o schema (npm run db:setup)
scripts/demo-seguranca.js       -> demonstração dos recursos de segurança (npm run demo:seguranca)
src/errors.js                   -> tipos de erro (validação, banco, etc.)
src/logger.js                   -> log técnico detalhado em logs/erros.log
src/middleware/errorHandler.js  -> Pilar 2
src/middleware/rateLimiter.js   -> Pilar 3
src/routes/estacionamento.js    -> rotas: /entrada /saida /ticket/:codigo /vagas /tarifas /painel
assets/index.html                -> interface do totem (design clean, estilo totem real)
tests/pilares.test.js            -> testes automatizados dos 3 pilares
docs/pilares.md                  -> documentação técnica dos pilares e arquitetura
docs/recursos-armazenamento.md   -> os 4 recursos de segurança da camada de dados
docs/deploy-supabase-render.md   -> como publicar (banco no Supabase + app no Render)
```

---

## Pilar 1 — Prevenção de SQL Injection

**O ataque:** alguém digita, no lugar de um dado comum (placa, código de
ticket), um pedaço de comando SQL — tentando fazer o banco executar algo que
não devia, como ler ou apagar dados.

**A defesa:** *consultas parametrizadas* (o equivalente aos *prepared statements*). Em vez de montar a query colando texto
(`"SELECT * FROM veiculos WHERE placa = '" + placa + "'"`), a gente separa o
comando dos dados:

```js
// src/db.js (dentro de encapsular(...))
buscarDentroPorPlaca: encapsular(
  `SELECT * FROM veiculos WHERE placa = $1 AND status = 'dentro' ORDER BY id DESC LIMIT 1`
),
```

O `$1` é um espaço reservado. O PostgreSQL recebe o comando e o valor **separados**,
e o valor entra sempre como *dado puro* — nunca como parte do comando. Então se alguém digitar `ABC1234'; DROP TABLE veiculos; --` no campo
de placa, isso vira literalmente uma string de placa (que nem passa na nossa
validação de formato) e não um comando executado.

Testamos isso na prática: mandamos uma placa com `'; DROP TABLE veiculos; --`
no corpo da requisição e o sistema apenas respondeu "Placa inválida" — a
tabela continua intacta.

Toda consulta do projeto (entre elas a que conta veículos dentro por tipo pra
controlar a vaga de carro separada da vaga de moto) usa esse padrão — nenhuma faz
concatenação de string SQL.

---

## Pilar 2 — Gestão de Erros do Lado do Servidor

**A regra de ouro:** log **detalhado** para o desenvolvedor, mensagem
**genérica** para quem está no totem.

**Por quê:** um Stack Trace exposto no navegador entrega de graça a linguagem
usada, o framework, a versão, o nome das tabelas e até o caminho de arquivos
no servidor — informação de ouro para quem quer atacar o sistema depois.

**Como fizemos:**

1. `src/errors.js` define erros com dois lados: uma `mensagemPublica` (segura
   de mostrar) e o `statusCode` HTTP correto (400 validação, 503 banco fora,
   etc).
2. `src/middleware/errorHandler.js` é o middleware final da cadeia do Express.
   Ele **sempre** loga o erro completo (`stack`, IP, corpo da requisição) em
   `logs/erros.log`, e **só depois** decide o que devolver ao cliente:
   - erro "esperado" (validação, banco indisponível) → mensagem já pensada
   - qualquer bug não previsto → mensagem 100% genérica: "Ocorreu um erro
     inesperado. Nossa equipe já foi notificada." — nunca `error.message` ou
     `error.stack` no JSON de resposta.
3. Cobrimos também: rota inexistente (404 tratado, não um erro cru do
   framework) e falhas do banco (try/catch em volta das escritas).

Fizemos o teste: forçamos um erro (ticket que já saiu, tentando sair de novo).
O cliente recebeu só `"Este veículo já registrou saída anteriormente."`,
enquanto o `logs/erros.log` guardou o stack trace inteiro, o IP e o corpo da
requisição — informação que fica só no servidor.

---

## Pilar 3 — Rate Limiting

**O problema do enunciado:** o cliente "fica apertando cadastrar 500 milhões
de vezes" — requisições sucessivas demais, seja um usuário afobado ou um bot
tentando abusar do sistema (ex.: gerar tickets em massa, ou tentar adivinhar
códigos de ticket na saída).

**Como implementamos** (`src/middleware/rateLimiter.js`), com uma janela
deslizante por IP guardada em memória:

- Cada IP tem uma lista de horários (timestamps) das últimas requisições.
- A cada nova requisição: descartamos os timestamps mais velhos que 60s,
  contamos quantos sobraram.
- Se passar de **10 requisições em 60 segundos**, o IP é bloqueado por mais
  **60 segundos** — resposta `429 Too Many Requests` com o cabeçalho
  `Retry-After` avisando quanto tempo falta.
- Aplicado apenas nas rotas de **escrita** (`/entrada` e `/saida`), que são
  as sensíveis a abuso. As rotas de leitura (`/vagas`, `/tarifas`, `/painel`,
  `/status`, `/health`) ficam de fora de propósito, já que são consultadas
  automaticamente pelo front (painel de vagas, tabela de tarifas) e não
  representam risco de força bruta.

Testamos com 12 requisições seguidas: as 10 primeiras passam normalmente
(`201`), a partir da 11ª o totem responde `429` com a mensagem "Muitas
tentativas. Tente novamente em 60s." — sem nem chegar a tocar no banco de
dados.

Em produção, o mesmo mecanismo normalmente migra para o Redis (para valer em
várias instâncias do servidor ao mesmo tempo); em memória já é suficiente
para o projeto e deixa o funcionamento bem visível para explicar.

---

## Roteiro para a apresentação oral

Um jeito direto de conduzir a fala, dividido nos três pilares:

1. **Contexto (30s):** "Escolhemos um totem de estacionamento porque é
   exatamente o tipo de sistema que o professor pediu: contato direto com
   muita gente, muitas requisições ao mesmo tempo, e um backend que precisa
   dar conta disso sem quebrar nem vazar informação."

2. **Pilar 1 (SQL Injection):** mostrar o código do `db.js` com o `?` nos
   prepared statements, explicar em uma frase por que isso protege, e fazer
   a demonstração ao vivo: tentar injetar `'; DROP TABLE veiculos; --` na
   placa e mostrar que o sistema apenas recusa e a tabela continua de pé.

3. **Pilar 2 (gestão de erros):** mostrar a diferença entre o que aparece na
   tela do totem (mensagem simples) e o que fica no `logs/erros.log`
   (stack trace completo). Explicar o motivo: stack trace no navegador
   entrega informação para um atacante.

4. **Pilar 3 (rate limiting):** rodar ao vivo (ou mostrar o teste já feito)
   uma sequência rápida de requisições e mostrar o `429` aparecendo depois da
   décima. Explicar a janela deslizante em uma frase.

5. **Fechamento (15s):** "Os três pilares trabalham juntos: um impede que o
   dado do usuário vire comando, o segundo garante que um erro não vaze
   informação do sistema, e o terceiro garante que ninguém consiga sobrecarregar
   o servidor sozinho."


---

## Recursos de segurança no armazenamento (camada de dados)

Além dos três pilares, o totem aplica os 4 recursos do slide *Recursos de
Segurança no Armazenamento*. Resumo (detalhes, como demonstrar e limitações em
[`docs/recursos-armazenamento.md`](docs/recursos-armazenamento.md)):

| Recurso do slide | Onde está |
|---|---|
| Criptografia em repouso | Discos cifrados pelo Supabase + conexão com SSL/TLS (`src/conexao.js`) |
| Hashing de senhas (bcrypt + salt) | `src/seguranca/operadores.js` e `autenticacao.js`; login em `POST /api/operador/login` |
| Princípio do menor privilégio | `db/schema.sql`: usuário `totem_app` só com `SELECT/INSERT/UPDATE` necessários; o servidor recusa subir em produção como administrador |
| Mascaramento de dados | `src/seguranca/mascaramento.js`; `GET /api/operador/painel` e `logs/erros.log` |

Testes: `npm test` (16 testes). Demonstração: `npm run demo:seguranca`.
