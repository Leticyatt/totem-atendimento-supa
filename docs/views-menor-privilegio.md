# Views e GRANT: ocultação estrutural de dados

Exercício de Segurança em Banco de Dados 2 (View + GRANT), adaptado ao totem de estacionamento.

## Cenário

A equipe de **suporte** precisa consultar os operadores do sistema e os veículos que estão no pátio.
Só que a tabela `operadores` guarda o `senha_hash`, e `veiculos` guarda a placa completa e o valor
pago. O suporte não precisa disso. Em vez de liberar as tabelas, criei **views** com só as colunas
seguras e dei ao usuário `suporte_leitura` permissão de leitura **apenas nelas**.

| View | Mostra | Oculta |
|---|---|---|
| `vw_operadores_publico` | `id`, `usuario`, `criado_em` | `senha_hash` |
| `vw_patio_publico` | `ticket`, `tipo`, `entrada`, placa mascarada (`***1D23`) | placa completa, `valor_pago`, `saida`, `status` (e veículos que já saíram) |

O script está em [`db/views.sql`](../db/views.sql). Antes de rodar no SQL Editor do Supabase,
troque `__SENHA_SUPORTE__` por uma senha forte (aparece uma vez). Os testes estão em
`tests/views.test.js` (`npm test`).

## Comandos principais

```sql
CREATE OR REPLACE VIEW vw_operadores_publico AS
SELECT id, usuario, criado_em FROM operadores;

REVOKE ALL ON veiculos, configuracao, operadores FROM suporte_leitura;
GRANT SELECT ON vw_operadores_publico TO suporte_leitura;
```

## Como demonstrar (SQL Editor do Supabase)

Cada bloco abaixo é um envio separado. O `SET LOCAL ROLE` vale só para aquele envio, então o
editor volta ao administrador sozinho. Os dois últimos **devem falhar**.

```sql
-- 1) como suporte, consulta a view: funciona (sem a coluna senha_hash)
SET LOCAL ROLE suporte_leitura;
SELECT * FROM vw_operadores_publico;
```

```sql
-- 2) como suporte, placa mascarada no pátio
SET LOCAL ROLE suporte_leitura;
SELECT * FROM vw_patio_publico;
```

```sql
-- 3) como suporte, tabela original -> ERROR: permission denied for table operadores
SET LOCAL ROLE suporte_leitura;
SELECT * FROM operadores;
```

```sql
-- 4) como suporte, tentar alterar pela view -> ERROR: permission denied
SET LOCAL ROLE suporte_leitura;
UPDATE vw_operadores_publico SET usuario = 'x';
```

Se o passo 1 der "permission denied to set role", rode `GRANT suporte_leitura TO CURRENT_USER;`
como administrador (o script já faz isso) e tente de novo.

## Detalhe importante do Supabase

Nas views eu **não** usei `security_invoker`. Por padrão, a view lê as tabelas com os direitos de
quem a criou, e é isso que permite ao suporte consultar a view sem acesso às tabelas. O efeito
colateral é que a view ignora o RLS, e o Supabase libera objetos novos do schema `public` para a
API pública (`anon`, `authenticated`). Por isso o script faz `REVOKE` nesses papéis: sem isso, a
view ficaria aberta para a internet.

## Relação com os outros recursos

É o princípio do menor privilégio do `db/schema.sql` (usuário `totem_app`) levado para a leitura, e
o mascaramento da placa é o mesmo do painel da aplicação (`***1D23`), agora feito dentro do banco.

## Para falar na apresentação

> No segundo exercício eu usei views para ocultar a estrutura sensível. Criei um usuário de suporte
> que precisa consultar operadores e veículos no pátio, mas não pode ver o hash da senha, a placa
> completa nem o valor pago. Então criei duas views só com as colunas seguras e dei SELECT nelas,
> sem nenhuma permissão nas tabelas originais. Aqui, como suporte, a consulta à view funciona; já na
> tabela original o banco responde permission denied, e também não deixa alterar nada pela view. Um
> cuidado extra que tomei foi no Supabase: tirei o acesso das views da API pública, porque a view
> ignora o RLS.
