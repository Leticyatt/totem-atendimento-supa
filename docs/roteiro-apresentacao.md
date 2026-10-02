Roteiro — Apresentação Totem de Estacionamento (Segurança de Sistemas)
Ordem pedida pelo professor: 1) estrutura/organização do código → 2) testes → 3) commits → 4) sistema rodando testando o checklist obrigatório. Você conduz a apresentação — este roteiro é seu apoio, com o que falar e exatamente onde mostrar no código ou no terminal em cada momento.

0. Abertura (30s)
"Nosso sistema é um totem de autoatendimento de estacionamento: entrada e saída de veículo, cálculo de tarifa e consulta de vagas. Ele implementa os três pilares de segurança pedidos e também os princípios da tríade CID. Vou mostrar primeiro como o projeto está organizado, depois os testes e os commits, e por fim vou rodar o sistema ao vivo e testar cada item do checklist."

1. Estrutura do código (mostrar na IDE, sem rodar nada ainda)
Abra a árvore de arquivos do projeto e vá apontando:

totem-atendimento/
├── config/config.js        → todas as configs num só lugar (tarifas, vagas, rate limit, porta)
├── src/
│   ├── app.js               → monta a aplicação (rotas + os 3 pilares)
│   ├── server.js             → só sobe o servidor (ponto de entrada)
│   ├── db.js                  → banco de dados (PostgreSQL) + queries parametrizadas
│   ├── errors.js               → erros tipados
│   ├── logger.js                → log técnico (console + arquivo)
│   ├── middleware/
│   │   ├── errorHandler.js       → Pilar 2
│   │   └── rateLimiter.js         → Pilar 3
│   └── routes/estacionamento.js   → rotas da API
├── assets/index.html         → interface visual do totem
├── tests/pilares.test.js     → testes automatizados dos 3 pilares
├── docs/pilares.md            → documentação técnica
├── package.json, .gitignore, README.md
Fale:

"Separei o projeto em config/ para as configurações, src/ para o código-fonte, assets/ para a interface, tests/ para os testes automatizados e docs/ para a documentação técnica — é a estrutura padrão que vocês pediram. Um destaque: separei app.js (a aplicação em si) de server.js (que só sobe o servidor) — isso é o que me permitiu escrever testes automatizados sem precisar abrir uma porta de verdade."

2. Testes automatizados
No terminal, dentro da pasta do projeto:

npm test
Mostre o resultado (3 testes passando: pass 3, fail 0).

Fale, apontando pra tests/pilares.test.js:

"Escrevi um teste automatizado pra cada pilar, usando o test runner nativo do Node, sem precisar adicionar nenhuma biblioteca nova. O primeiro manda uma placa com um comando SQL malicioso e confere que o sistema não quebra. O segundo bate numa rota que não existe e confere que a resposta não vaza nenhum detalhe técnico — tipo caminho de arquivo. O terceiro dispara 12 requisições seguidas e confere que a partir da décima o sistema começa a bloquear com 429."

3. Commits (histórico versionado)
No terminal:

git log --oneline
Mostre a lista de commits e narre a evolução:

Commit	O que fala
Versão inicial ... (vibe coding)	"Esse é o ponto de partida: o backend já com os 3 pilares implementados."
refactor: renomear public/ para assets/	"Primeiro ajuste de estrutura: renomeei a pasta que serve a interface web pro nome padrão."
refactor: criar config/config.js e separar app.js de server.js	"Aqui tirei os valores fixos do código e centralizei em config/, e separei a aplicação do que sobe o servidor — isso é o que abriu espaço pra testar."
test: adicionar testes automatizados + docs/pilares.md	"Nessa etapa escrevi os testes e documentei os pilares."
docs: atualizar README	"Por último, atualizei a documentação geral do projeto."
docs: adicionar roteiro da apresentação	"Documentei também o roteiro que estou seguindo agora."
fix: restringir rate limiting às rotas de escrita	"E aqui corrigi um detalhe de design: o rate limit estava valendo pra qualquer rota de /api, inclusive consultas automáticas de vagas — o que bloqueava o usuário sem ele ter feito nada de errado. Agora só se aplica em /entrada e /saida."
Fale:

"Cada etapa da reorganização ficou registrada em um commit separado, então dá pra acompanhar a evolução do projeto do estado inicial até a estrutura final."

(Se ele pedir pra ver o diff de algum commit: git show <hash> --stat.)

4. Sistema rodando — checklist ao vivo
Suba o servidor:

npm start
Abra http://localhost:3000 no navegador (interface do totem) e deixe um terminal separado aberto pros comandos curl abaixo.

✅ Pilar 1 — Prevenção de SQL Injection
Onde no código: src/db.js — todas as queries usam pool.query(...) com $1, $2 no lugar do valor (nunca concatenação de string) — são as queries parametrizadas, o equivalente aos prepared statements.

Demonstração ao vivo:

curl -X POST http://localhost:3000/api/entrada \
  -H "Content-Type: application/json" \
  -d '{"placa":"'"'"'; DROP TABLE veiculos; --","tipo":"carro"}'
Resultado esperado: 400 com "Placa inválida..." — o texto malicioso nunca vira comando, é tratado só como dado (e nem passa na validação de formato).

Prove que a tabela sobreviveu:

curl http://localhost:3000/api/vagas
Mostra a contagem de vagas normalmente — nada foi apagado.

Fale: "O $1 faz o PostgreSQL receber o comando e o valor separados. Então o que a pessoa digitar nunca vira parte do SQL — vira só um texto."

✅ Pilar 2 — Gestão de erros no servidor
Onde no código: src/errors.js (classe ErroDeValidacao, define mensagem pública x detalhe interno) e src/middleware/errorHandler.js (loga tudo em logErro(...) antes de decidir o que o cliente recebe — isso vale pra QUALQUER erro, inclusive validações simples). Os dois exemplos abaixo são lançados em src/routes/estacionamento.js, linhas 61 e 96.

Explique a mecânica primeiro (30s), sem rodar nada ainda:

"Toda vez que uma rota lança um erro, ele passa pelo errorHandler.js. Antes de responder qualquer coisa pro cliente, ele já loga o detalhe técnico completo — stack trace, IP, corpo da requisição — no arquivo logs/erros.log. Só depois disso ele decide qual mensagem genérica devolver pra tela do totem."

Exemplo 1 — placa inválida
curl -X POST http://localhost:3000/api/entrada \
  -H "Content-Type: application/json" \
  -d '{"placa":"XYZ","tipo":"carro"}'
Tela do totem / resposta da API: 400 — "Placa inválida. Use o formato ABC1234 ou ABC1D23."

No terminal, mostre o log gerado por trás:

cat logs/erros.log
Aparece uma linha assim (formatada aqui só pra leitura):

{
  "quando": "2026-09-16T...",
  "contexto": "POST /api/entrada",
  "mensagem": "Placa inválida. Use o formato ABC1234 ou ABC1D23.",
  "stack": "ErroDeValidacao: Placa inválida...\n    at ...",
  "ip": "::1",
  "body": { "placa": "XYZ", "tipo": "carro" }
}
Fale: "Repara: a tela mostrou só a frase genérica. Mas aqui no log eu tenho o stack trace completo, o IP de quem fez a requisição e exatamente o que foi enviado no corpo — é isso que eu, como desenvolvedora, uso pra investigar. O usuário do totem nunca vê nada disso."

Exemplo 2 — ticket ou placa não encontrado
curl -X POST http://localhost:3000/api/saida \
  -H "Content-Type: application/json" \
  -d '{"ticket":"T-9999-NAO-EXISTE"}'
Tela do totem / resposta da API: 400 — "Ticket ou placa não encontrado(a)."

Mesmo cat logs/erros.log mostra outra linha, agora com "contexto": "POST /api/saida" e o body com o ticket forjado — de novo, só no arquivo, nunca na tela.

Exemplo 3 — tentar sair duas vezes com o mesmo ticket (fluxo completo)
# 1) entrada
curl -X POST http://localhost:3000/api/entrada -H "Content-Type: application/json" -d '{"tipo":"carro"}'
# copie o "ticket" da resposta e use abaixo (ex.: T-XXXX)

# 2) primeira saída (funciona)
curl -X POST http://localhost:3000/api/saida -H "Content-Type: application/json" -d '{"ticket":"T-XXXX"}'

# 3) segunda saída no mesmo ticket (erro tratado)
curl -X POST http://localhost:3000/api/saida -H "Content-Type: application/json" -d '{"ticket":"T-XXXX"}'
Resultado esperado no passo 3: mensagem genérica "Este veículo já registrou saída anteriormente." — sem stack trace, sem nome de arquivo.

Mostre o console do servidor (onde rodou npm start): aparece a linha [ERRO] ... | POST /api/saida | ... — o detalhe técnico fica só ali, e o cat logs/erros.log mostra o registro completo desse terceiro caso também.

Fale: "O usuário do totem recebe só a frase genérica. O stack trace completo, com IP e corpo da requisição, fica registrado aqui no servidor, pra eu poder investigar depois."

✅ Pilar 3 — Rate Limiting
Onde no código: src/middleware/rateLimiter.js (janela deslizante por IP) + config/config.js (limite: 10 requisições / 60s, bloqueio de 60s). Aplicado em src/routes/estacionamento.js, só nas rotas de escrita (/entrada e /saida) — decisão de design: consultar vagas/tarifas (rotas de leitura, chamadas sozinhas pelo front a cada 15s) não representa abuso e por isso fica de fora do limite.

Demonstração ao vivo:

for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/entrada -H "Content-Type: application/json" -d '{"tipo":"carro"}'; done
Resultado esperado: dez 201 seguidos e depois 429 nas últimas duas.

Fale: "Isso simula alguém apertando o botão de 'registrar entrada' sem parar. Depois da décima requisição no mesmo minuto, o IP fica bloqueado por 60 segundos — mas só nas ações de escrita; se eu ficar só olhando o painel de vagas, isso nunca me bloqueia, porque não é esse o comportamento que queremos conter."

✅ Tríade CID
🔒 Confidencialidade
Onde: src/errors.js + src/middleware/errorHandler.js — a resposta de erro nunca inclui error.stack, error.message cru nem qualquer segredo/chave.

Fale, apontando o trecho do errorHandler.js:

"Aqui no código a resposta pro cliente é sempre montada manualmente com uma mensagem pública — nunca devolvemos erro.stack ou erro.message direto no JSON. Isso garante que, mesmo se o sistema tivesse alguma chave de API ou segredo, ele nunca vazaria numa resposta de erro."

(Pode reaproveitar a mesma demonstração do Pilar 2 pra provar isso — a resposta do passo 3 não tem nada além da mensagem genérica.)

✅ Integridade
Onde: src/routes/estacionamento.js, rota POST /api/saida — o valor a pagar é sempre calculado com getConfigNumero('valor_' + tipo), lendo do banco/config no servidor. O corpo da requisição de saída só tem ticket/placa — nunca um valor de preço vindo do cliente.

Demonstração ao vivo: tente mandar um valor forjado e mostre que ele é ignorado:

curl -X POST http://localhost:3000/api/saida \
  -H "Content-Type: application/json" \
  -d '{"ticket":"T-XXXX", "valor": 0.01}'
O resumo.valor na resposta continua sendo a tarifa real configurada no servidor (R$ 13,00 ou R$ 10,00) — o 0.01 enviado é simplesmente ignorado pela rota.

Fale: "Mesmo que eu tente forçar um valor de R$ 0,01 no corpo da requisição, o backend ignora completamente esse campo — o preço real é sempre recalculado aqui no servidor, nunca confiando no que vem do cliente."

🌐 Disponibilidade
Onde: src/middleware/rateLimiter.js (evita sobrecarga por excesso de requisições) e o endpoint GET /api/health em src/app.js (monitoramento do estado do backend/banco).

Seja honesta aqui — isso é importante pro professor ver que você entende o limite do que fez:

"Balanceamento de carga entre múltiplos servidores é uma solução de infraestrutura — nosso projeto roda como uma instância única, então não implementamos um load balancer de verdade. O que implementamos que contribui pra disponibilidade foi: o rate limiting, que evita que o servidor fique sobrecarregado por excesso de requisições, e o endpoint /api/health, que permite monitorar se o backend e o banco de dados estão respondendo — a base que, em produção, se ligaria a uma ferramenta de monitoramento."

Demonstração ao vivo (opcional):

curl http://localhost:3000/api/health
5. Encerramento (15s)
"Resumindo: prevenção de SQL Injection com queries parametrizadas, erros tratados sem vazar informação, rate limiting contra excesso de requisições, e os três pilares da tríade CID — confidencialidade nas respostas de erro, integridade no cálculo do valor no servidor, e disponibilidade com o rate limiter e o health check. Tudo isso documentado, testado automaticamente e versionado em commits."