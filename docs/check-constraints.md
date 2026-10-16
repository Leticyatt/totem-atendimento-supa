# Restrições de validação (Check Constraints) no banco

Exercício de Segurança em Banco de Dados 2. O cenário foi adaptado ao totem de estacionamento.

## Cenário

O back-end valida entrada, placa e tarifa. Mas se alguém contornar essa validação (um bug, uma
chamada direta à API ou acesso à conexão do banco), dado sem sentido poderia ser gravado: valor
pago negativo, saída anterior à entrada, placa fora do padrão. As regras abaixo fazem o **próprio
banco** recusar esses dados. É uma segunda camada de defesa.

## Regras criadas (tabela `veiculos`)

| Regra | O que garante |
|---|---|
| `ck_valor_pago_positivo` | `valor_pago`, quando preenchido, é maior que zero (NULL vale: veículo ainda no pátio) |
| `ck_saida_apos_entrada` | `saida` nunca é anterior a `entrada` |
| `ck_placa_formato` | placa no padrão `ABC1234` ou Mercosul `ABC1D23` (NULL vale: placa é opcional) |

As regras de `tipo` (`carro`/`moto`) e `status` (`dentro`/`saiu`) já existiam no `db/schema.sql`.

O script está em [`db/constraints.sql`](../db/constraints.sql). É idempotente e roda no SQL Editor
do Supabase com o usuário administrador. Os testes automatizados estão em
`tests/constraints.test.js` (`npm test`).

## Como demonstrar (SQL Editor do Supabase)

Rode cada comando separado, porque o editor para no primeiro erro. Os três primeiros **devem falhar**.

```sql
-- 1) valor negativo -> ERROR: violates check constraint "ck_valor_pago_positivo"
UPDATE veiculos SET valor_pago = -10 WHERE id = (SELECT MIN(id) FROM veiculos);

-- 2) saída antes da entrada -> ERROR: violates check constraint "ck_saida_apos_entrada"
UPDATE veiculos SET saida = entrada - interval '1 hour' WHERE id = (SELECT MIN(id) FROM veiculos);

-- 3) placa inválida -> ERROR: violates check constraint "ck_placa_formato"
UPDATE veiculos SET placa = 'AB-123' WHERE id = (SELECT MIN(id) FROM veiculos);

-- 4) caso válido (passa) e desfaz em seguida, sem alterar os dados
BEGIN;
UPDATE veiculos SET valor_pago = 10 WHERE id = (SELECT MIN(id) FROM veiculos);
ROLLBACK;
```

Para listar as regras ativas:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'veiculos'::regclass AND contype = 'c';
```

## Relação com o Pilar 2 (gestão de erros)

Se o banco recusar uma gravação, o `db.js` converte o erro em `ErroDeBancoDeDados` (503). O
usuário vê só "Não foi possível concluir a operação...", e o detalhe (nome da regra) vai para o
log do servidor. Nenhum código da aplicação precisou mudar.

## Atenção

A tarifa é lida da tabela `configuracao`. Se o administrador gravar `valor_carro` ou `valor_moto`
como `0`, a saída será recusada pela regra 1, e é o comportamento desejado (tarifa zerada é erro
de configuração). Se um dia existir saída gratuita, troque `> 0` por `>= 0` na regra.

## Para falar na apresentação

> Apliquei restrições de validação (check constraints) direto na tabela de veículos do totem. A ideia
> é que o banco recuse dado inválido mesmo se a validação do front-end ou do back-end for
> contornada. Criei três regras: o valor pago precisa ser maior que zero, a saída não pode ser
> anterior à entrada e a placa precisa seguir o padrão brasileiro. Aqui eu tento gravar um valor
> negativo e o banco rejeita; o mesmo acontece com a saída antes da entrada e com a placa
> inválida. O caso válido passa normalmente. E, como já tínhamos o tratamento de erros, o usuário
> do totem só vê uma mensagem genérica, e o detalhe técnico fica no log.
