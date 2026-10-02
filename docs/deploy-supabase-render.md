# Publicando o totem: Supabase (banco) + Render (aplicação)

Objetivo: o professor abre um link e o totem funciona, sem depender do seu PC.

```
Navegador do professor ──► Render (Node/Express, o totem) ──► Supabase (PostgreSQL)
                            usuário do banco: totem_app          tabelas + RLS
                            (restrito, SEM poder de admin)
```

O **Supabase** guarda só o banco. O **Render** roda o servidor Node (`npm start`).
São dois serviços e os dois têm plano gratuito.

> Dica: faça tudo isso com pelo menos um dia de folga antes da apresentação.

---

## Parte 1 — Criar o banco no Supabase

1. Em <https://supabase.com> crie uma conta e um **New project**.
   - Região: escolha a mais próxima (ex.: South America / São Paulo).
   - **Database password**: use só letras e números (evita problemas na URL) e anote.
2. Quando o projeto ficar pronto, clique em **Connect** (barra do topo) e escolha
   **Session pooler**. Anote duas coisas:
   - o **host**, no formato `aws-X-REGIAO.pooler.supabase.com`;
   - o **project ref** (aparece no usuário `postgres.XXXXXXXX`).
   Use **sempre o Session pooler (porta 5432)**: a conexão direta do Supabase é só IPv6 e
   o Render não consegue usá-la.

## Parte 2 — Configurar e preparar o banco (no seu PC, uma única vez)

1. Copie `.env.example` para `.env` e preencha (troque `REF`, `HOST` e as senhas):

   ```env
   ADMIN_DATABASE_URL=postgresql://postgres.REF:SENHA_DO_PROJETO@HOST:5432/postgres
   APP_DB_PASSWORD=UmaSenhaForteSoComLetrasENumeros123
   DATABASE_URL=postgresql://totem_app.REF:UmaSenhaForteSoComLetrasENumeros123@HOST:5432/postgres
   ```

   - `ADMIN_DATABASE_URL`: usuário administrador (`postgres`). **Só no seu PC.**
   - `DATABASE_URL`: usuário restrito `totem_app` (é este que vai para o Render).
   - `APP_DB_PASSWORD` e a senha dentro de `DATABASE_URL` são a **mesma** senha.

2. No terminal, dentro da pasta do projeto:

   ```bash
   npm install
   npm run db:setup                  # cria tabelas, usuário totem_app, permissões e RLS
   npm run operador:criar -- admin   # cadastra o operador (a senha é pedida no terminal)
   npm start                         # teste local: http://localhost:3000
   ```

   No painel do Supabase (**Table Editor**) você já vê as tabelas `veiculos`,
   `configuracao` e `operadores`.

   *Alternativa sem terminal:* em **SQL Editor**, cole `db/schema.sql`, troque o texto
   `__SENHA_DO_APP__` pela senha do `totem_app` e clique em Run.

3. Ao subir, o terminal deve mostrar:
   `Banco conectado como usuário restrito "totem_app" (menor privilégio).`

## Parte 3 — Publicar a aplicação no Render

1. Suba o projeto para um repositório no GitHub (o `.gitignore` já impede o envio do `.env`).
2. Em <https://render.com>: **New → Web Service** → escolha o repositório.
3. Configure:

   | Campo | Valor |
   |---|---|
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance type | Free |

4. Em **Environment**, crie apenas estas variáveis:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a URL do `totem_app` (a mesma do `.env`) |
   | `NODE_ENV` | `production` |

   **Não** crie `ADMIN_DATABASE_URL` nem `APP_DB_PASSWORD` no Render: o servidor nunca
   precisa da senha de administrador.
5. Clique em **Create Web Service**. Quando terminar, abra o link `https://seu-app.onrender.com`.

Com `NODE_ENV=production` o servidor **recusa subir** se a `DATABASE_URL` for de um usuário
administrador. É o Princípio do Menor Privilégio sendo imposto pelo próprio sistema.

## Antes de apresentar

- **Acorde tudo antes.** No plano gratuito o Render "dorme" depois de um tempo sem acessos e
  o primeiro acesso pode levar cerca de um minuto. O projeto gratuito do Supabase também é
  pausado após cerca de uma semana sem uso (se acontecer, é só clicar em *Restore* no painel).
  Abra o link e faça uma entrada/saída de teste uns 10 minutos antes.
- Conferir: `https://seu-app.onrender.com/api/health` deve responder `operacional`.
- Para a demonstração dos recursos de segurança no terminal: `npm run demo:seguranca`
  (usa o `.env` do seu PC apontando para o mesmo banco do Supabase).
- Tenha um plano B: o totem também roda no seu PC (`npm start`) falando com o mesmo banco.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `password authentication failed for user "totem_app"` | A senha da `DATABASE_URL` não é a mesma do `APP_DB_PASSWORD`. Rode `npm run db:setup` de novo (ele atualiza a senha). |
| `Tenant or user not found` | O usuário no pooler precisa do sufixo: `totem_app.REF`, não só `totem_app`. |
| `ENETUNREACH` / timeout | Você usou a conexão direta (IPv6). Use o **Session pooler**. |
| Senha com `@`, `#`, `/` quebra a URL | Use uma senha só com letras e números. |
| Totem no Render responde 503 | Banco pausado (Supabase) ou `DATABASE_URL` errada. Veja os *Logs* do Render. |
| Muitos "Muitas tentativas" para todo mundo | O Render fica atrás de proxy; o projeto já trata (`NODE_ENV=production` ativa `trust proxy`). |
