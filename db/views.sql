-- =====================================================================
-- views.sql  -  Views (visões) para ocultação estrutural de dados
-- =====================================================================
-- Exercício: Segurança em Banco de Dados 2 (View + GRANT).
--
-- CENÁRIO (inventado para o totem): a equipe de SUPORTE do estacionamento
-- precisa consultar quem opera o sistema e quais veículos estão no pátio, mas
-- NÃO pode ver o senha_hash dos operadores, a placa completa nem o valor pago.
-- Em vez de liberar as tabelas, criamos "tabelas virtuais" só com as colunas
-- seguras e damos ao usuário de suporte permissão SOMENTE nelas.
--
-- Views:
--   vw_operadores_publico -> id, usuario, criado_em   (oculta senha_hash)
--   vw_patio_publico      -> ticket, tipo, entrada, placa mascarada
--                            (só veículos dentro; oculta valor_pago/status/saida)
--
-- Usuário: suporte_leitura -> SELECT apenas nas duas views, nada nas tabelas.
--
-- Como rodar: SQL Editor do Supabase (administrador). Antes, troque o marcador
-- __SENHA_SUPORTE__ (aparece UMA vez) por uma senha forte. Idempotente.
-- =====================================================================

-- ---------- 1) Views ----------
-- (sem security_invoker, de propósito: a view lê as tabelas com os direitos do
--  DONO, então o suporte consulta a view sem ter acesso às tabelas)

CREATE OR REPLACE VIEW vw_operadores_publico AS
SELECT id, usuario, criado_em
FROM operadores;

CREATE OR REPLACE VIEW vw_patio_publico AS
SELECT ticket,
       tipo,
       entrada,
       CASE WHEN placa IS NULL THEN NULL ELSE '***' || right(placa, 4) END AS placa
FROM veiculos
WHERE status = 'dentro';

-- ---------- 2) Usuário de suporte ----------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suporte_leitura') THEN
    CREATE ROLE suporte_leitura
      LOGIN
      PASSWORD '__SENHA_SUPORTE__'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Permite ao administrador assumir esse papel (SET ROLE) para demonstrar/testar.
GRANT suporte_leitura TO CURRENT_USER;

-- ---------- 3) Permissões: menor privilégio ----------

-- Garante que o suporte NÃO tem nada nas tabelas originais...
REVOKE ALL ON veiculos, configuracao, operadores FROM suporte_leitura;
GRANT USAGE ON SCHEMA public TO suporte_leitura;

-- ...e só lê (SELECT) as views.
REVOKE ALL ON vw_operadores_publico, vw_patio_publico FROM suporte_leitura;
GRANT SELECT ON vw_operadores_publico TO suporte_leitura;
GRANT SELECT ON vw_patio_publico      TO suporte_leitura;

-- ATENÇÃO (Supabase): objetos novos no schema public são liberados por padrão
-- para os papéis da API pública (anon/authenticated). Como a view lê as tabelas
-- com direitos do dono (ignora o RLS), deixar isso aberto exporia os dados.
-- Por isso tiramos qualquer acesso desses papéis às views.
REVOKE ALL ON vw_operadores_publico, vw_patio_publico FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON vw_operadores_publico, vw_patio_publico FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON vw_operadores_publico, vw_patio_publico FROM authenticated';
  END IF;
END
$$;
