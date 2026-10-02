# Totem de Autoatendimento para Estacionamento — Pilares de Segurança

Documentação técnica do trabalho da disciplina de **Segurança de Sistemas
da Informação**. O sistema simula um totem de autoatendimento de
estacionamento (entrada e saída de veículos, cálculo de tarifa) e
implementa os 3 pilares exigidos pelo professor.

## Arquitetura

```
totem-atendimento/
├── config/    → configurações centralizadas (tarifas, vagas, rate limit, porta)
├── src/       → código-fonte da aplicação
│   ├── app.js         → monta a aplicação Express (rotas + middlewares)
│   ├── server.js       → ponto de entrada, apenas sobe o servidor
│   ├── db.js            → acesso ao banco (PostgreSQL/Supabase via pg)
│   ├── errors.js        → classes de erro tipadas
│   ├── logger.js         → logging estruturado
│   ├── middleware/       → rate limiter e tratador de erros
│   └── routes/           → rotas da API do estacionamento
├── assets/    → front-end estático servido pelo Express (HTML/CSS/JS)
├── tests/     → testes automatizados dos 3 pilares
└── docs/      → esta documentação
```

## Pilar 1 — Prevenção de SQL Injection

Toda consulta em `src/db.js` usa **queries parametrizadas**
(`pool.query('... WHERE placa = $1', [placa])`), nunca concatenação de string.
Entradas do usuário (placa, tipo de veículo) nunca viram parte literal
do comando SQL — são sempre passadas como parâmetro (`?`).

## Pilar 2 — Gestão de erros no servidor

- `src/errors.js` define erros tipados (ex.: `ErroDeValidacao`,
  `ErroDeBancoDeDados`).
- `src/middleware/errorHandler.js` centraliza o tratamento: loga o erro
  completo no servidor (`logger.js`) e devolve ao usuário apenas uma
  mensagem genérica e o status HTTP adequado, sem vazar detalhes
  internos (stack trace, caminho de arquivo, etc.).
- Rotas inexistentes (`rotaNaoEncontrada`) e falhas de infraestrutura
  (banco travado, disco cheio) também passam pelo mesmo tratamento.

## Pilar 3 — Rate limiting

`src/middleware/rateLimiter.js` implementa uma janela deslizante por IP,
guardada em memória. Os parâmetros (limite de requisições, duração da
janela, tempo de bloqueio) ficam em `config/config.js`. Ao estourar o
limite, o cliente recebe `429 Too Many Requests` e fica temporariamente
bloqueado.

## Testes

`tests/pilares.test.js` cobre os três pilares com o test runner nativo
do Node (`node:test`), sem dependências externas:

```bash
npm test
```
