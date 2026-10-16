-- =====================================================================
-- constraints.sql  -  Restrições de validação (CHECK) da tabela veiculos
-- =====================================================================
-- Exercício: Segurança em Banco de Dados 2 (Check Constraints).
--
-- IDEIA: o back-end já valida os dados (src/routes/estacionamento.js), mas se
-- essa validação for contornada (bug, acesso direto à API, alguém com a
-- conexão do banco), o PRÓPRIO BANCO recusa o dado inválido. É uma segunda
-- camada de defesa, no esquema.
--
-- Já existiam no schema.sql (não foram alteradas aqui):
--   tipo   IN ('carro', 'moto')
--   status IN ('dentro', 'saiu')
--
-- Regras adicionadas neste arquivo:
--   1) ck_valor_pago_positivo  -> valor_pago, quando preenchido, é maior que zero
--   2) ck_saida_apos_entrada   -> saida não pode ser anterior à entrada
--   3) ck_placa_formato        -> placa no padrão antigo (ABC1234) ou Mercosul (ABC1D23)
--
-- Como rodar: SQL Editor do Supabase (usuário administrador) -> cole -> Run.
-- É idempotente: pode rodar de novo sem erro (só cria a regra que faltar).
--
-- ANTES de rodar em um banco com dados, confira se há linha que viole as regras
-- (o ADD CONSTRAINT falha se houver). Rode uma de cada vez:
--   SELECT id, ticket, valor_pago FROM veiculos WHERE valor_pago <= 0;
--   SELECT id, ticket, entrada, saida FROM veiculos WHERE saida < entrada;
--   SELECT id, placa FROM veiculos
--    WHERE placa IS NOT NULL AND placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$';
-- =====================================================================

DO $$
BEGIN
  -- 1) Valor pago: NULL é permitido (o veículo ainda está no pátio e não pagou).
  --    A tarifa do totem é fixa (> 0); valor negativo ou zero é sempre erro.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ck_valor_pago_positivo'
                    AND conrelid = 'public.veiculos'::regclass) THEN
    ALTER TABLE public.veiculos
      ADD CONSTRAINT ck_valor_pago_positivo
      CHECK (valor_pago IS NULL OR valor_pago > 0);
  END IF;

  -- 2) Saída (preenchida só quando o veículo sai) não pode ser antes da entrada.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ck_saida_apos_entrada'
                    AND conrelid = 'public.veiculos'::regclass) THEN
    ALTER TABLE public.veiculos
      ADD CONSTRAINT ck_saida_apos_entrada
      CHECK (saida IS NULL OR saida >= entrada);
  END IF;

  -- 3) Placa: o back-end já normaliza para MAIÚSCULAS e sem hífen antes de gravar.
  --    Placa é opcional no totem, então NULL continua válido.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'ck_placa_formato'
                    AND conrelid = 'public.veiculos'::regclass) THEN
    ALTER TABLE public.veiculos
      ADD CONSTRAINT ck_placa_formato
      CHECK (placa IS NULL OR placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');
  END IF;
END
$$;
