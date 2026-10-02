-- =====================================================================
-- schema.sql  -  Banco do Totem de Atendimento (PostgreSQL / Supabase)
-- =====================================================================
-- Rode UMA vez, com o usuário ADMINISTRADOR do banco (no Supabase: o
-- usuário "postgres"). Duas formas:
--
--   a) Pelo terminal:  npm run db:setup     (lê ADMIN_DATABASE_URL e
--                      APP_DB_PASSWORD do arquivo .env)
--   b) Pelo painel do Supabase: SQL Editor -> cole este arquivo ->
--      troque o marcador da senha na linha CREATE ROLE (procure por
--      SENHA_DO_APP) por uma senha forte -> Run.
--
-- O script é idempotente: pode rodar de novo sem estragar nada.
--
-- RECURSO 3 - PRINCÍPIO DO MENOR PRIVILÉGIO
-- O back-end NÃO conecta como administrador. Ele conecta como "totem_app",
-- um usuário que só consegue o que a aplicação precisa:
--   veiculos      -> SELECT, INSERT, UPDATE   (sem DELETE, sem DROP)
--   configuracao  -> SELECT                    (tarifas/vagas só o admin altera)
--   operadores    -> SELECT                    (o login só lê o hash; quem
--                                               cadastra operador é o admin)
-- =====================================================================

-- ---------- 1) Tabelas (criadas pelo administrador, que é o dono) ----------

CREATE TABLE IF NOT EXISTS veiculos (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket     TEXT NOT NULL UNIQUE,
  placa      TEXT,
  tipo       TEXT NOT NULL DEFAULT 'carro' CHECK (tipo IN ('carro', 'moto')),
  entrada    TIMESTAMPTZ NOT NULL DEFAULT now(),
  saida      TIMESTAMPTZ,
  valor_pago NUMERIC(10, 2),
  status     TEXT NOT NULL DEFAULT 'dentro' CHECK (status IN ('dentro', 'saiu'))
);

CREATE INDEX IF NOT EXISTS idx_veiculos_status_tipo ON veiculos (status, tipo);
CREATE INDEX IF NOT EXISTS idx_veiculos_placa ON veiculos (placa);

CREATE TABLE IF NOT EXISTS configuracao (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operadores (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario    TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,           -- só o hash bcrypt, nunca a senha
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Valores-semente (mesmos de config/config.js). Para mudar depois, use
-- UPDATE como administrador; o usuário da aplicação não tem esse poder.
INSERT INTO configuracao (chave, valor) VALUES
  ('vagas_totais_carro', '50'),
  ('vagas_totais_moto',  '10'),
  ('valor_carro',        '13.00'),
  ('valor_moto',         '10.00')
ON CONFLICT (chave) DO NOTHING;

-- ---------- 2) Usuário restrito da aplicação ----------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'totem_app') THEN
    CREATE ROLE totem_app
      LOGIN
      PASSWORD '__SENHA_DO_APP__'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSE
    -- Rodou de novo (ex.: trocando a senha): atualiza a senha do usuário existente.
    ALTER ROLE totem_app WITH PASSWORD '__SENHA_DO_APP__';
  END IF;
END
$$;

-- Garante que ninguém herda permissão por acidente e depois concede só o necessário.
REVOKE ALL ON veiculos, configuracao, operadores FROM PUBLIC;
REVOKE ALL ON veiculos, configuracao, operadores FROM totem_app;

GRANT USAGE ON SCHEMA public TO totem_app;
GRANT SELECT, INSERT, UPDATE ON veiculos     TO totem_app;
GRANT SELECT                 ON configuracao TO totem_app;
GRANT SELECT                 ON operadores   TO totem_app;

-- ---------- 3) Row Level Security ----------
-- No Supabase, as tabelas do schema "public" também ficam expostas pela API
-- REST pública (chave "anon"). Ligar o RLS sem criar política para esses
-- papéis faz a API pública enxergar ZERO linhas. Só o totem_app tem política.

ALTER TABLE veiculos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE operadores   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS totem_app_veiculos     ON veiculos;
DROP POLICY IF EXISTS totem_app_configuracao ON configuracao;
DROP POLICY IF EXISTS totem_app_operadores   ON operadores;

-- (o que cada comando pode fazer continua limitado pelos GRANT acima)
CREATE POLICY totem_app_veiculos     ON veiculos     FOR ALL    TO totem_app USING (true) WITH CHECK (true);
CREATE POLICY totem_app_configuracao ON configuracao FOR SELECT TO totem_app USING (true);
CREATE POLICY totem_app_operadores   ON operadores   FOR SELECT TO totem_app USING (true);

-- Se existirem os papéis da API do Supabase, tira qualquer acesso direto deles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON veiculos, configuracao, operadores FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON veiculos, configuracao, operadores FROM authenticated';
  END IF;
END
$$;
